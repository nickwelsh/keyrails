import type { OptionalLogger } from "@rocicorp/logger";

import type { ReadonlyJSONObject, ReadonlyJSONValue } from "./json.js";

/**
 * An entity is something that can be read or written by Rails.
 */
export type Entity = {
	id: string;
};

type DefaultKeyField<T> = Extract<Extract<keyof T, string>, "id">;

export type Update<T, KeyField extends Extract<keyof T, string> = DefaultKeyField<T>> = Pick<T, KeyField> & Partial<T>;

type UpdateWith<RecordShape, T, KeyField extends Extract<keyof RecordShape, string>> = Pick<RecordShape, KeyField> &
	Partial<T>;

/**
 * A function that can parse a JSON value into a specific type.
 * Parse should throw an error if the value cannot be parsed.
 */
export type Parse<T> = (val: ReadonlyJSONValue) => T;

export type ParseInternal<T> = (tx: ReadTransaction, val: ReadonlyJSONValue) => T;

export function maybeParse<T>(parse: Parse<T> | undefined, val: ReadonlyJSONValue): T {
	if (parse === undefined) {
		return val as T;
	}
	return parse(val);
}
/**
 * The subset of the Replicache scan options used by this library.
 */
export type ScanOptions = {
	prefix?: string | undefined;
	start?:
		| {
				key?: string | undefined;
		  }
		| undefined;
	limit?: number | undefined;
};

/**
 * The subset of the Replicache scan result used by this library.
 */
export type ScanResult = {
	values(): AsyncIterable<ReadonlyJSONValue>;
	keys(): AsyncIterable<string>;
	entries(): AsyncIterable<Readonly<[string, ReadonlyJSONValue]>>;
};

/**
 * The subset of the Replicache read transaction used by this library.
 */
export type ReadTransaction = {
	readonly clientID: string;
	has(key: string): Promise<boolean>;
	get(key: string): Promise<ReadonlyJSONValue | undefined>;
	scan(options?: ScanOptions): ScanResult;
};

/**
 * The subset of the Replicache write transaction used by this library.
 */
export type WriteTransaction = ReadTransaction & {
	set(key: string, value: ReadonlyJSONValue): Promise<void>;
	del(key: string): Promise<boolean>;
};

export type GenerateOptions<
	T extends ReadonlyJSONObject,
	KeyField extends Extract<keyof T, string>,
	LookupID = T[KeyField],
	ID = LookupID,
> = {
	parse?: Parse<T>;
	logger?: OptionalLogger;
	primaryKey: KeyField;
	serialize?: (id: LookupID) => string;
	deserialize?: (raw: string) => ID;
	keyFromEntity?: KeyFromEntityFunc<T>;
	keyFromID?: KeyFromLookupIDFunc<LookupID>;
	keyToID?: KeyToIDFunc<ID>;
	idFromEntity?: IDFromEntityFunc<T, LookupID>;
	firstKey?: FirstKeyFunc;
};

export type GenerateResult<
	T extends ReadonlyJSONObject,
	LookupID = string,
	ID = LookupID,
	KeyField extends Extract<keyof T, string> = DefaultKeyField<T>,
> = {
	/** Write `value`, overwriting any previous version of same value. */
	set: (tx: WriteTransaction, value: T) => Promise<void>;
	/** Write `value` only if no previous version of this value exists. */
	init: (tx: WriteTransaction, value: T) => Promise<boolean>;
	/** Update existing value with new fields. */
	update: (tx: WriteTransaction, value: Update<T, KeyField>) => Promise<void>;
	/** Delete any existing value or do nothing if none exist. */
	delete: (tx: WriteTransaction, id: LookupID) => Promise<void>;
	/** Return true if specified value exists, false otherwise. */
	has: (tx: ReadTransaction, id: LookupID) => Promise<boolean>;
	/** Get value by ID, or return undefined if none exists. */
	get: (tx: ReadTransaction, id: LookupID) => Promise<T | undefined>;
	/** Get value by ID, or throw if none exists. */
	mustGet: (tx: ReadTransaction, id: LookupID) => Promise<T>;
	/** List values matching criteria. */
	list: (tx: ReadTransaction, options?: ListOptionsWith<LookupID>) => Promise<T[]>;
	/** List ids matching criteria. */
	listIDs: (tx: ReadTransaction, options?: ListOptionsWith<LookupID>) => Promise<ID[]>;
	/** List [id, value] entries matching criteria. */
	listEntries: (tx: ReadTransaction, options?: ListOptionsWith<LookupID>) => Promise<[ID, T][]>;
};

/**
 * Generates strongly-typed CRUD-style functions for Replicache records.
 */
export function generate<T extends Entity>(
	prefix: string,
	parse?: Parse<T>,
	logger?: OptionalLogger,
): GenerateResult<T>;
export function generate<
	T extends ReadonlyJSONObject,
	KeyField extends Extract<keyof T, string>,
	LookupID = T[KeyField],
	ID = LookupID,
>(prefix: string, options: GenerateOptions<T, KeyField, LookupID, ID>): GenerateResult<T, LookupID, ID, KeyField>;
export function generate<
	T extends ReadonlyJSONObject,
	KeyField extends Extract<keyof T, string> = DefaultKeyField<T>,
	LookupID = T[KeyField],
	ID = LookupID,
>(
	prefix: string,
	parseOrOptions: Parse<T> | GenerateOptions<T, KeyField, LookupID, ID> | undefined = undefined,
	logger: OptionalLogger = console,
): GenerateResult<T, LookupID, ID, KeyField> {
	const config = resolveGenerateConfig(prefix, parseOrOptions, logger);
	const { parse, keyFromEntity, keyFromID, keyToID, idFromEntity, firstKey } = config;
	const parseInternal: ParseInternal<T> = (_, val) => maybeParse(parse, val);
	const set: GenerateResult<T, LookupID, ID, KeyField>["set"] = (tx, value) =>
		setImpl(keyFromEntity, parseInternal, tx, value);

	return {
		set,
		init: (tx, value) => initImpl(keyFromEntity, parseInternal, tx, value),
		update: (tx, update) =>
			updateImpl(
				keyFromEntity,
				idFromEntity,
				parseInternal,
				parseInternal,
				tx,
				update as UpdateWith<T, T, KeyField>,
				config.logger,
			),
		delete: (tx, id) => deleteImpl(keyFromID, noop, tx, id),
		has: (tx, id) => hasImpl(keyFromID, tx, id),
		get: (tx, id) => getImpl(keyFromID, parseInternal, tx, id),
		mustGet: (tx, id) => mustGetImpl(keyFromID, parseInternal, tx, id),
		list: (tx, options?) => listImpl(keyFromID, keyToID, firstKey, parse, tx, options),
		listIDs: (tx, options?) => listIDsImpl(keyFromID, keyToID, firstKey, tx, options),
		listEntries: (tx, options?) => listEntriesImpl(keyFromID, keyToID, firstKey, parse, tx, options),
	};
}

export async function initImpl<V extends ReadonlyJSONValue, E extends ReadonlyJSONObject>(
	keyFunc: KeyFromEntityFunc<E>,
	parse: ParseInternal<E>,
	tx: WriteTransaction,
	initial: V,
) {
	const val = parse(tx, initial);
	const k = keyFunc(tx, val);
	if (await tx.has(k)) {
		return false;
	}
	await tx.set(k, val);
	return true;
}

export type KeyFromEntityFunc<T extends ReadonlyJSONObject> = (tx: ReadTransaction, id: T) => string;

export type IDFromEntityFunc<T extends ReadonlyJSONObject, ID> = (tx: ReadTransaction, entity: T) => ID;

export async function setImpl<V extends ReadonlyJSONObject, E extends ReadonlyJSONObject>(
	keyFromEntity: KeyFromEntityFunc<E>,
	parse: ParseInternal<E>,
	tx: WriteTransaction,
	initial: V,
): Promise<void> {
	const val = parse(tx, initial);
	await tx.set(keyFromEntity(tx, val), val);
}

export function hasImpl<LookupID>(keyFromID: KeyFromLookupIDFunc<LookupID>, tx: ReadTransaction, id: LookupID) {
	return tx.has(keyFromID(id));
}

export type KeyFromLookupIDFunc<LookupID> = (id: LookupID) => string;

export type ValidateMutateFunc<LookupID> = (tx: { clientID: string }, id: LookupID) => void;

export type KeyToIDFunc<ID> = (key: string) => ID | undefined;

export type FirstKeyFunc = () => string;

export function getImpl<T extends ReadonlyJSONObject, LookupID>(
	keyFromID: KeyFromLookupIDFunc<LookupID>,
	parse: ParseInternal<T>,
	tx: ReadTransaction,
	lookupID: LookupID,
): Promise<T | undefined> {
	return getInternal(parse, tx, keyFromID(lookupID));
}

export async function mustGetImpl<LookupID, T extends ReadonlyJSONObject>(
	keyFromID: KeyFromLookupIDFunc<LookupID>,
	parse: ParseInternal<T>,
	tx: ReadTransaction,
	lookupID: LookupID,
) {
	const v = await getInternal(parse, tx, keyFromID(lookupID));
	if (v === undefined) {
		throw new Error(`no such entity ${JSON.stringify(lookupID)}`);
	}
	return v;
}

export async function updateImpl<
	RecordShape extends ReadonlyJSONObject,
	T extends RecordShape,
	ID,
	KeyField extends Extract<keyof RecordShape, string>,
>(
	keyFromEntity: KeyFromEntityFunc<RecordShape>,
	idFromEntity: IDFromEntityFunc<RecordShape, ID>,
	parseExisting: ParseInternal<RecordShape>,
	parseNew: ParseInternal<RecordShape>,
	tx: WriteTransaction,
	update: UpdateWith<RecordShape, T, KeyField>,
	logger: OptionalLogger,
) {
	const record = update as unknown as RecordShape;
	const k = keyFromEntity(tx, record);
	const prev = await getInternal(parseExisting, tx, k);
	if (prev === undefined) {
		const entityID = idFromEntity(tx, record);
		logger.debug?.(`no such entity ${JSON.stringify(entityID)}, skipping update`);
		return;
	}
	const next = { ...prev, ...update };
	const parsed = parseNew(tx, next);
	await tx.set(k, parsed);
}

export async function deleteImpl<LookupID>(
	keyFromLookupID: KeyFromLookupIDFunc<LookupID>,
	validateMutate: ValidateMutateFunc<LookupID>,
	tx: WriteTransaction,
	lookupID: LookupID,
) {
	validateMutate(tx, lookupID);
	await tx.del(keyFromLookupID(lookupID));
}

export type ListOptions = {
	startAtID?: string;
	limit?: number;
};

export async function* scan<ID, LookupID>(
	keyFromLookupID: KeyFromLookupIDFunc<LookupID>,
	keyToID: KeyToIDFunc<ID>,
	firstKey: FirstKeyFunc,
	tx: ReadTransaction,
	options?: ListOptionsWith<LookupID>,
): AsyncIterable<Readonly<[ID, ReadonlyJSONValue]>> {
	const { startAtID, limit } = options ?? {};
	const fk = firstKey();
	for await (const [k, v] of tx
		.scan({
			prefix: fk,
			start: {
				key: startAtID === undefined ? fk : keyFromLookupID(startAtID),
			},
			limit,
		})
		.entries()) {
		const entryID = keyToID(k);
		if (entryID !== undefined) {
			yield [entryID, v];
		}
	}
}

export type ListOptionsWith<ID> = {
	startAtID?: ID;
	limit?: number;
};

export async function listImpl<T extends ReadonlyJSONObject, LookupID, ID>(
	keyFromID: KeyFromLookupIDFunc<LookupID>,
	keyToID: KeyToIDFunc<ID>,
	firstKey: FirstKeyFunc,
	parse: Parse<T> | undefined,
	tx: ReadTransaction,
	options?: ListOptionsWith<LookupID>,
) {
	const result = [];
	for await (const [, v] of scan(keyFromID, keyToID, firstKey, tx, options)) {
		result.push(maybeParse(parse, v));
	}
	return result;
}

export async function listIDsImpl<LookupID, ID>(
	keyFromID: KeyFromLookupIDFunc<LookupID>,
	keyToID: KeyToIDFunc<ID>,
	firstKey: FirstKeyFunc,
	tx: ReadTransaction,
	options?: ListOptionsWith<LookupID>,
): Promise<ID[]> {
	const result: ID[] = [];
	for await (const [k] of scan(keyFromID, keyToID, firstKey, tx, options)) {
		result.push(k);
	}
	return result;
}

export async function listEntriesImpl<T extends ReadonlyJSONObject, LookupID, ID>(
	keyFromID: KeyFromLookupIDFunc<LookupID>,
	keyToID: KeyToIDFunc<ID>,
	firstKey: FirstKeyFunc,
	parse: Parse<T> | undefined,
	tx: ReadTransaction,
	options?: ListOptionsWith<LookupID>,
): Promise<[ID, T][]> {
	const result: [ID, T][] = [];
	for await (const [k, v] of scan(keyFromID, keyToID, firstKey, tx, options)) {
		result.push([k, maybeParse(parse, v)]);
	}
	return result;
}

async function getInternal<T extends ReadonlyJSONValue>(
	parse: ParseInternal<T>,
	tx: ReadTransaction,
	storageKey: string,
): Promise<T | undefined> {
	const val = await tx.get(storageKey);
	if (val === undefined) {
		return val;
	}
	return parse(tx, val);
}

function noop(): void {
	// intentionally empty
}

function makeKey(prefix: string, rawID: string) {
	return `${prefix}/${rawID}`;
}

function stripPrefix(prefix: string, storageKey: string) {
	return storageKey.slice(prefix.length + 1);
}

function resolveGenerateConfig<
	T extends ReadonlyJSONObject,
	KeyField extends Extract<keyof T, string>,
	LookupID = T[KeyField],
	ID = LookupID,
>(
	prefix: string,
	parseOrOptions: Parse<T> | GenerateOptions<T, KeyField, LookupID, ID> | undefined,
	logger: OptionalLogger,
): {
	parse: Parse<T> | undefined;
	logger: OptionalLogger;
	keyFromEntity: KeyFromEntityFunc<T>;
	keyFromID: KeyFromLookupIDFunc<LookupID>;
	keyToID: KeyToIDFunc<ID>;
	idFromEntity: IDFromEntityFunc<T, LookupID>;
	firstKey: FirstKeyFunc;
} {
	if (typeof parseOrOptions === "function" || parseOrOptions === undefined) {
		const idFromEntity: IDFromEntityFunc<T, LookupID> = (_tx, entity) => entity.id as LookupID;
		const keyFromID: KeyFromLookupIDFunc<LookupID> = (value) => makeKey(prefix, String(value));

		return {
			parse: parseOrOptions,
			logger,
			keyFromEntity: (tx, entity) => keyFromID(idFromEntity(tx, entity)),
			keyFromID,
			keyToID: (raw) => stripPrefix(prefix, raw) as ID,
			idFromEntity,
			firstKey: () => makeKey(prefix, ""),
		};
	}

	const {
		parse,
		logger: configuredLogger = console,
		primaryKey,
		serialize = String,
		deserialize = (raw) => raw as ID,
	} = parseOrOptions;
	const idFromEntity =
		parseOrOptions.idFromEntity ?? ((_tx: ReadTransaction, entity: T) => entity[primaryKey] as LookupID);
	const keyFromID = parseOrOptions.keyFromID ?? ((lookupID: LookupID) => makeKey(prefix, serialize(lookupID)));

	return {
		parse,
		logger: configuredLogger,
		keyFromEntity: parseOrOptions.keyFromEntity ?? ((tx, entity) => keyFromID(idFromEntity(tx, entity))),
		keyFromID,
		keyToID: parseOrOptions.keyToID ?? ((raw) => deserialize(stripPrefix(prefix, raw))),
		idFromEntity,
		firstKey: parseOrOptions.firstKey ?? (() => makeKey(prefix, "")),
	};
}
