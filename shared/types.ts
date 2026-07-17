export interface ActivityLog {
  roomId: string;
  username: string;
  keystrokeCount: number;
  inEditor: boolean;
  clientId: string;
  recordedAt?: Date;
}

export interface UserAwareness {
  clientId: number;
  username: string;
  color: string;
  cursor?: {
    anchor: number;
    head: number;
  };
}
