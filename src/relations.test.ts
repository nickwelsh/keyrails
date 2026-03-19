import { expect, test } from "vitest";
import { z } from "zod";

import { generate } from "./generate.js";
import { generateAssociation, generateBelongsTo, generateManyToMany, generatePivot } from "./relations.js";
import { MemoryTx } from "./test-memory.js";

const todo = z.object({
	id: z.string(),
	title: z.string(),
	userID: z.string().nullable(),
});

type Todo = z.infer<typeof todo>;

const todoTag = z.object({
	id: z.string(),
	todoID: z.string(),
	tagID: z.string(),
});

type TodoTag = z.infer<typeof todoTag>;

const todos = generate<Todo>("todo", (value) => todo.parse(value));
const todoTags = generate<TodoTag>("todo-tag", (value) => todoTag.parse(value));
const todoUser = generateAssociation<Todo, string, string, "userID">(todos, "userID");
const tagPivot = generatePivot<TodoTag, string, string, string>({
	pivot: todoTags,
	makePivotID: (todoID, tagID) => `${todoID}:${tagID}`,
	createPivot: (todoID, tagID) => ({
		id: `${todoID}:${tagID}`,
		todoID,
		tagID,
	}),
	getSourceID: (value) => value.todoID,
	getRelatedID: (value) => value.tagID,
});

test("supports associate and dissociate helpers", async () => {
	const tx = new MemoryTx();

	await todos.set(tx, { id: "todo-1", title: "Draft", userID: null });
	await todoUser.associate(tx, { id: "todo-1", relatedID: "user-1" });

	expect(await todos.get(tx, "todo-1")).toEqual({
		id: "todo-1",
		title: "Draft",
		userID: "user-1",
	});

	await todoUser.dissociate(tx, "todo-1");

	expect(await todos.get(tx, "todo-1")).toEqual({
		id: "todo-1",
		title: "Draft",
		userID: null,
	});
});

test("exports belongs-to alias", async () => {
	const tx = new MemoryTx();
	const todoOwner = generateBelongsTo<Todo, string, string, "userID">(todos, "userID");

	await todos.set(tx, { id: "todo-2", title: "Review", userID: null });
	await todoOwner.associate(tx, { id: "todo-2", relatedID: "user-2" });

	expect(await todos.get(tx, "todo-2")).toEqual({
		id: "todo-2",
		title: "Review",
		userID: "user-2",
	});
});

test("supports attach detach and sync pivot helpers", async () => {
	const tx = new MemoryTx();

	expect(await tagPivot.attach(tx, { sourceID: "todo-1", relatedID: "tag-a" })).toBe(true);
	expect(await tagPivot.attach(tx, { sourceID: "todo-1", relatedID: "tag-a" })).toBe(false);

	expect(await tagPivot.listRelatedIDs(tx, "todo-1")).toEqual(["tag-a"]);

	await tagPivot.detach(tx, { sourceID: "todo-1", relatedID: "tag-a" });

	expect(await tagPivot.listRelatedIDs(tx, "todo-1")).toEqual([]);

	await tagPivot.attach(tx, { sourceID: "todo-1", relatedID: "tag-a" });

	expect(
		await tagPivot.sync(tx, {
			sourceID: "todo-1",
			relatedIDs: ["tag-b", "tag-c"],
		}),
	).toEqual({
		attached: ["tag-b", "tag-c"],
		detached: ["tag-a"],
	});

	const relatedIDs = await tagPivot.listRelatedIDs(tx, "todo-1");

	expect([...relatedIDs].sort()).toEqual(["tag-b", "tag-c"]);
});

test("supports pivot has list alias and sync no-op branches", async () => {
	const tx = new MemoryTx();
	const aliasedPivot = generateManyToMany<TodoTag, string, string, string>({
		pivot: todoTags,
		makePivotID: (todoID, tagID) => `${todoID}:${tagID}`,
		createPivot: (todoID, tagID, attributes) => ({
			id: `${todoID}:${tagID}`,
			todoID,
			tagID,
			...attributes,
		}),
		getSourceID: (value) => value.todoID,
		getRelatedID: (value) => value.tagID,
		sourceKey: (id) => id.toLowerCase(),
		relatedKey: (id) => id.toLowerCase(),
	});

	await aliasedPivot.attach(tx, {
		sourceID: "Todo-3",
		relatedID: "Tag-A",
	});

	expect(await aliasedPivot.has(tx, { sourceID: "Todo-3", relatedID: "Tag-A" })).toBe(true);
	expect(await aliasedPivot.list(tx, "todo-3")).toEqual([
		{ id: "Todo-3:Tag-A", todoID: "Todo-3", tagID: "Tag-A" },
	]);

	expect(
		await aliasedPivot.sync(tx, {
			sourceID: "todo-3",
			relatedIDs: ["tag-a", "tag-b", "tag-b"],
			attributesFor: (relatedID) => (relatedID === "tag-b" ? { id: "Todo-3:Tag-B" } : undefined),
		}),
	).toEqual({
		attached: ["tag-b"],
		detached: [],
	});

	expect(await aliasedPivot.listRelatedIDs(tx, "todo-3")).toEqual(["Tag-A", "tag-b"]);
});
