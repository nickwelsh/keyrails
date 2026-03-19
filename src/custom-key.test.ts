import { expect, test } from "vitest";
import { z } from "zod";

import { generate } from "./generate.js";
import { MemoryTx } from "./test-memory.js";

const todo = z.object({
	todoID: z.number(),
	title: z.string(),
});

type Todo = z.infer<typeof todo>;

const objectKeyEntity = z.object({
	pk: z.object({
		tenant: z.string(),
		slug: z.string(),
	}),
	title: z.string(),
});

type ObjectKeyEntity = z.infer<typeof objectKeyEntity>;

const todos = generate<Todo, "todoID", number, number>("todo", {
	primaryKey: "todoID",
	parse: (value) => todo.parse(value),
	serialize: String,
	deserialize: Number,
});

const objectKeys = generate<ObjectKeyEntity, "pk", ObjectKeyEntity["pk"], ObjectKeyEntity["pk"]>("object-key", {
	primaryKey: "pk",
	parse: (value) => objectKeyEntity.parse(value),
	serialize: (value) => `${value.tenant}:${value.slug}`,
	deserialize: (value) => {
		const [tenant = "", slug = ""] = value.split(":");
		return { tenant, slug };
	},
});

test("supports non-id primary keys", async () => {
	const tx = new MemoryTx();

	await todos.set(tx, { todoID: 7, title: "start" });
	await todos.update(tx, { todoID: 7, title: "done" });

	expect(await tx.get("todo/7")).toEqual({
		todoID: 7,
		title: "done",
	});
	expect(await todos.get(tx, 7)).toEqual({
		todoID: 7,
		title: "done",
	});
	expect(await todos.listIDs(tx)).toEqual([7]);

	await todos.delete(tx, 7);

	expect(await todos.get(tx, 7)).toBeUndefined();
});

test("supports arbitrary primary key types via serializer", async () => {
	const tx = new MemoryTx();
	const pk = { tenant: "acme", slug: "alpha" };

	await objectKeys.set(tx, { pk, title: "first" });
	await objectKeys.update(tx, { pk, title: "second" });

	expect(await tx.get("object-key/acme:alpha")).toEqual({ pk, title: "second" });
	expect(await objectKeys.get(tx, pk)).toEqual({
		pk,
		title: "second",
	});
	expect(await objectKeys.listIDs(tx)).toEqual([pk]);
});
