import type { GenerateResult, ReadTransaction, WriteTransaction } from "./generate.js";
import type { ReadonlyJSONObject } from "./json.js";

export type AssociateArgs<ParentID, RelatedID> = {
	id: ParentID;
	relatedID: RelatedID | null;
};

export type GenerateAssociationResult<ParentID, RelatedID> = {
	associate: (tx: WriteTransaction, args: AssociateArgs<ParentID, RelatedID>) => Promise<void>;
	dissociate: (tx: WriteTransaction, id: ParentID) => Promise<void>;
};

export function generateAssociation<
	Parent extends ReadonlyJSONObject,
	ParentID,
	RelatedID,
	ForeignKey extends Extract<keyof Parent, string>,
>(
	entity: Pick<GenerateResult<Parent, ParentID>, "mustGet" | "set">,
	foreignKey: ForeignKey,
): GenerateAssociationResult<ParentID, RelatedID> {
	const associate = async (tx: WriteTransaction, { id, relatedID }: AssociateArgs<ParentID, RelatedID>) => {
		const current = await entity.mustGet(tx, id);
		await entity.set(tx, { ...current, [foreignKey]: relatedID } as Parent);
	};

	return {
		associate,
		dissociate: (tx, id) => associate(tx, { id, relatedID: null }),
	};
}

export const generateBelongsTo = generateAssociation;

export type PivotArgs<SourceID, RelatedID> = {
	sourceID: SourceID;
	relatedID: RelatedID;
};

export type SyncPivotArgs<Pivot extends ReadonlyJSONObject, SourceID, RelatedID> = {
	sourceID: SourceID;
	relatedIDs: Iterable<RelatedID>;
	attributesFor?: (relatedID: RelatedID) => Partial<Pivot> | undefined;
};

export type GeneratePivotOptions<Pivot extends ReadonlyJSONObject, PivotID, SourceID, RelatedID> = {
	pivot: Pick<GenerateResult<Pivot, PivotID>, "init" | "delete" | "has" | "list">;
	makePivotID: (sourceID: SourceID, relatedID: RelatedID) => PivotID;
	createPivot: (sourceID: SourceID, relatedID: RelatedID, attributes?: Partial<Pivot>) => Pivot;
	getSourceID: (pivot: Pivot) => SourceID;
	getRelatedID: (pivot: Pivot) => RelatedID;
	sourceKey?: (id: SourceID) => string;
	relatedKey?: (id: RelatedID) => string;
};

export type GeneratePivotResult<Pivot extends ReadonlyJSONObject, SourceID, RelatedID> = {
	attach: (
		tx: WriteTransaction,
		args: PivotArgs<SourceID, RelatedID> & { attributes?: Partial<Pivot> },
	) => Promise<boolean>;
	detach: (tx: WriteTransaction, args: PivotArgs<SourceID, RelatedID>) => Promise<void>;
	has: (tx: ReadTransaction, args: PivotArgs<SourceID, RelatedID>) => Promise<boolean>;
	list: (tx: ReadTransaction, sourceID: SourceID) => Promise<Pivot[]>;
	listRelatedIDs: (tx: ReadTransaction, sourceID: SourceID) => Promise<RelatedID[]>;
	sync: (
		tx: WriteTransaction,
		args: SyncPivotArgs<Pivot, SourceID, RelatedID>,
	) => Promise<{ attached: RelatedID[]; detached: RelatedID[] }>;
};

export function generatePivot<Pivot extends ReadonlyJSONObject, PivotID, SourceID, RelatedID>(
	options: GeneratePivotOptions<Pivot, PivotID, SourceID, RelatedID>,
): GeneratePivotResult<Pivot, SourceID, RelatedID> {
	const {
		pivot,
		makePivotID,
		createPivot,
		getSourceID,
		getRelatedID,
		sourceKey = String,
		relatedKey = String,
	} = options;

	const list = async (tx: ReadTransaction, sourceID: SourceID) => {
		const all = await pivot.list(tx);
		const match = sourceKey(sourceID);

		return all.filter((value) => sourceKey(getSourceID(value)) === match);
	};

	const attach: GeneratePivotResult<Pivot, SourceID, RelatedID>["attach"] = (
		tx,
		{ sourceID, relatedID, attributes },
	) => pivot.init(tx, createPivot(sourceID, relatedID, attributes));

	const detach: GeneratePivotResult<Pivot, SourceID, RelatedID>["detach"] = (tx, { sourceID, relatedID }) =>
		pivot.delete(tx, makePivotID(sourceID, relatedID));

	return {
		attach,
		detach,
		has: (tx, { sourceID, relatedID }) => pivot.has(tx, makePivotID(sourceID, relatedID)),
		list,
		listRelatedIDs: async (tx, sourceID) => (await list(tx, sourceID)).map((value) => getRelatedID(value)),
		sync: async (tx, { sourceID, relatedIDs, attributesFor }) => {
			const existing = await list(tx, sourceID);
			const existingByRelated = new Map(
				existing.map((value) => [relatedKey(getRelatedID(value)), value] as const),
			);
			const desired = new Map<ReturnType<typeof relatedKey>, RelatedID>();

			for (const relatedID of relatedIDs) {
				desired.set(relatedKey(relatedID), relatedID);
			}

			const attached: RelatedID[] = [];
			const detached: RelatedID[] = [];

			for (const [key, value] of existingByRelated) {
				if (desired.has(key)) {
					continue;
				}

				const relatedID = getRelatedID(value);
				await detach(tx, { sourceID, relatedID });
				detached.push(relatedID);
			}

			for (const [key, relatedID] of desired) {
				if (existingByRelated.has(key)) {
					continue;
				}

				await attach(tx, {
					sourceID,
					relatedID,
					attributes: attributesFor?.(relatedID),
				});
				attached.push(relatedID);
			}

			return { attached, detached };
		},
	};
}

export const generateManyToMany = generatePivot;
