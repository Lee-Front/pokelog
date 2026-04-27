// === Trade ===
export type TradeStatus = "pending" | "accepted" | "rejected" | "cancelled";

export interface TradeRecord {
  id: string;
  requesterUserId: string;
  requesterPokemonUid: string;
  responderUserId: string;
  responderPokemonUid: string;
  status: TradeStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface TradePokemonCandidate {
  uid: string;
  species: string;
  speciesName: string;
  nickname: string | null;
  level: number;
  location: "party" | "storage";
}
