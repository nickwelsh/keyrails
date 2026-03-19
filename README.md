# Keyrails

Key-configurable CRUD + relation helpers for Replicache.

What it does:

- generate CRUD helpers for records with any primary-key field
- support any key type, as long as you can serialize it into a Replicache key
- keep validation pluggable via any parse fn, including `zod`
- add higher-level relation helpers for foreign keys and pivot tables

## Credit

This is heavily based on [Rocicorp's Rails package](https://github.com/rocicorp/rails)

## Install

```bash
npm install keyrails
```

```bash
yarn add keyrails
```

```bash
pnpm add keyrails
```

```bash
bun add keyrails
```

## CRUD

Basic `id` records still work:

```ts
import { generate } from "keyrails";
import { z } from "zod";

const todoSchema = z.object({
	id: z.string(),
	title: z.string(),
	complete: z.boolean(),
});

export const todos = generate("todo", todoSchema.parse);
```

Custom PK fields work too:

```ts
import { generate } from "keyrails";
import { z } from "zod";

const todoSchema = z.object({
	todoID: z.number(),
	title: z.string(),
	complete: z.boolean(),
});

export const todos = generate("todo", {
	primaryKey: "todoID",
	parse: todoSchema.parse,
	serialize: (value) => String(value),
	deserialize: (value) => Number(value),
});
```

The generated API is:

- `set(tx, value)`
- `init(tx, value)`
- `update(tx, value)`
- `delete(tx, id)`
- `has(tx, id)`
- `get(tx, id)`
- `mustGet(tx, id)`
- `list(tx, options?)`
- `listIDs(tx, options?)`
- `listEntries(tx, options?)`

`update()` requires the configured primary-key field, not hard-coded `id`.

## Arbitrary Key Types

Replicache keys are strings, so non-string IDs need encode/decode functions.

```ts
const docSchema = z.object({
	pk: z.object({
		tenant: z.string(),
		slug: z.string(),
	}),
	title: z.string(),
});

export const docs = generate("doc", {
	primaryKey: "pk",
	parse: docSchema.parse,
	serialize: (value) => `${value.tenant}:${value.slug}`,
	deserialize: (value) => {
		const [tenant = "", slug = ""] = value.split(":");
		return { tenant, slug };
	},
});
```

## Validation

Validation is just a parse function. `zod` works, but anything with the same shape works.

```ts
const companySchema = z.object({
	companyID: z.string().uuid(),
	name: z.string().min(1),
});

export const companies = generate("company", {
	primaryKey: "companyID",
	parse: companySchema.parse,
});
```

## Relations

Relation helpers are separate from base CRUD on purpose:

- base CRUD owns storage and primary-key handling
- relation helpers compose on top of that
- relation helpers stay explicit about which records they mutate

### Foreign Key Relation

Use `generateAssociation()` when one record stores a foreign key directly.

```ts
import { generate, generateAssociation } from "keyrails";
import { z } from "zod";

const todoSchema = z.object({
	id: z.string(),
	title: z.string(),
	userID: z.string().nullable(),
});

const todos = generate("todo", todoSchema.parse);

const todoUser = generateAssociation(todos, "userID");
```

That gives you:

- `associate(tx, {id, relatedID})`
- `dissociate(tx, id)`

Example mutators:

```ts
export const mutators = {
	setTodo: todos.set,
	assignTodoUser: (tx: WriteTransaction, args: { id: string; relatedID: string | null }) =>
		todoUser.associate(tx, args),
	clearTodoUser: (tx: WriteTransaction, id: string) => todoUser.dissociate(tx, id),
};
```

What it actually does:

1. load the parent record with `mustGet`
2. rewrite the foreign-key field
3. save the full record back with `set`

So for the example above:

```ts
await todoUser.associate(tx, {
	id: "todo-1",
	relatedID: "user-7",
});
```

turns:

```ts
{id: 'todo-1', title: 'Draft', userID: null}
```

into:

```ts
{id: 'todo-1', title: 'Draft', userID: 'user-7'}
```

and `dissociate()` writes `userID: null`.

### Pivot / Many-to-Many

Use `generatePivot()` for join rows like `todo_tag`.

```ts
import { generate, generatePivot } from "keyrails";
import { z } from "zod";

const todoTagSchema = z.object({
	id: z.string(),
	todoID: z.string(),
	tagID: z.string(),
	position: z.number().optional(),
});

const todoTags = generate("todo-tag", todoTagSchema.parse);

const tagPivot = generatePivot({
	pivot: todoTags,
	makePivotID: (todoID, tagID) => `${todoID}:${tagID}`,
	createPivot: (todoID, tagID, attributes) => ({
		id: `${todoID}:${tagID}`,
		todoID,
		tagID,
		...attributes,
	}),
	getSourceID: (row) => row.todoID,
	getRelatedID: (row) => row.tagID,
});
```

That gives you:

- `attach(tx, {sourceID, relatedID, attributes?})`
- `detach(tx, {sourceID, relatedID})`
- `has(tx, {sourceID, relatedID})`
- `list(tx, sourceID)`
- `listRelatedIDs(tx, sourceID)`
- `sync(tx, {sourceID, relatedIDs, attributesFor?})`

Example mutators:

```ts
export const mutators = {
	attachTodoTag: (tx: WriteTransaction, args: { sourceID: string; relatedID: string }) => tagPivot.attach(tx, args),
	detachTodoTag: (tx: WriteTransaction, args: { sourceID: string; relatedID: string }) => tagPivot.detach(tx, args),
	syncTodoTags: (tx: WriteTransaction, args: { sourceID: string; relatedIDs: string[] }) => tagPivot.sync(tx, args),
};
```

Attach creates the pivot row once:

```ts
await tagPivot.attach(tx, {
	sourceID: "todo-1",
	relatedID: "tag-a",
});
```

That writes:

```ts
{
  id: 'todo-1:tag-a',
  todoID: 'todo-1',
  tagID: 'tag-a',
}
```

Attach returns `false` if the pivot already exists, because it uses `init()`.

Detach removes exactly one pivot row:

```ts
await tagPivot.detach(tx, {
	sourceID: "todo-1",
	relatedID: "tag-a",
});
```

Sync diffs current vs desired related IDs:

```ts
await tagPivot.sync(tx, {
	sourceID: "todo-1",
	relatedIDs: ["tag-b", "tag-c"],
});
```

If current rows are:

```ts
[
	{ id: "todo-1:tag-a", todoID: "todo-1", tagID: "tag-a" },
	{ id: "todo-1:tag-b", todoID: "todo-1", tagID: "tag-b" },
];
```

then sync will:

- detach `tag-a`
- keep `tag-b`
- attach `tag-c`

and return:

```ts
{
  attached: ['tag-c'],
  detached: ['tag-a'],
}
```

### Pivot With Extra Attributes

If your join row carries extra data, use `attributes` on `attach()` or `attributesFor()` on `sync()`.

```ts
await tagPivot.attach(tx, {
	sourceID: "todo-1",
	relatedID: "tag-a",
	attributes: { position: 1 },
});

await tagPivot.sync(tx, {
	sourceID: "todo-1",
	relatedIDs: ["tag-a", "tag-b"],
	attributesFor: (relatedID) => ({
		position: relatedID === "tag-a" ? 1 : 2,
	}),
});
```

### Non-String Relation IDs

If your source or related IDs are not strings, pass `sourceKey` and `relatedKey` so `sync()` can diff them correctly.

```ts
const memberships = generatePivot({
	pivot: membershipRows,
	makePivotID: (userID, teamID) => `${userID}:${teamID.org}:${teamID.slug}`,
	createPivot: (userID, teamID) => ({
		id: `${userID}:${teamID.org}:${teamID.slug}`,
		userID,
		teamID,
	}),
	getSourceID: (row) => row.userID,
	getRelatedID: (row) => row.teamID,
	relatedKey: (teamID) => `${teamID.org}:${teamID.slug}`,
});
```
