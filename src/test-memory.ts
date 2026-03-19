import type { ReadTransaction, ScanOptions, ScanResult, WriteTransaction } from "./generate.js";
import type { ReadonlyJSONValue } from "./json.js";

export class MemoryTx implements WriteTransaction {
	readonly clientID = "test-client";
	readonly #data = new Map<string, ReadonlyJSONValue>();

	has(key: string): Promise<boolean> {
		return Promise.resolve(this.#data.has(key));
	}

	get(key: string): Promise<ReadonlyJSONValue | undefined> {
		return Promise.resolve(this.#data.get(key));
	}

	set(key: string, value: ReadonlyJSONValue): Promise<void> {
		this.#data.set(key, value);
		return Promise.resolve();
	}

	del(key: string): Promise<boolean> {
		return Promise.resolve(this.#data.delete(key));
	}

	scan(options?: ScanOptions): ScanResult {
		const entries = filterEntries(this.#data, options);

		return {
			entries: () => iterable(entries),
			keys: () => iterable(entries.map(([key]) => key)),
			values: () => iterable(entries.map(([, value]) => value)),
		};
	}
}

function filterEntries(data: Map<string, ReadonlyJSONValue>, options?: ScanOptions): [string, ReadonlyJSONValue][] {
	const prefix = options?.prefix;
	const startKey = options?.start?.key;
	const limit = options?.limit ?? Infinity;
	const entries = [...data.entries()] as [string, ReadonlyJSONValue][];

	entries.sort(([a], [b]) => a.localeCompare(b));

	return entries
		.filter(([key]) => {
			if (prefix !== undefined && !key.startsWith(prefix)) {
				return false;
			}

			if (startKey !== undefined && key < startKey) {
				return false;
			}

			return true;
		})
		.slice(0, limit);
}

function iterable<T>(values: T[]): AsyncIterable<T> {
	return {
		[Symbol.asyncIterator]() {
			const iterator = values[Symbol.iterator]();

			return {
				next() {
					return Promise.resolve(iterator.next());
				},
			};
		},
	};
}

export function asReadTransaction(tx: MemoryTx): ReadTransaction {
	return tx;
}
