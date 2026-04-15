export interface QueueEntry {
  userId: string;
  socketId: string;
  nickname: string;
}

let queue: QueueEntry[] = [];

export function enqueue(entry: QueueEntry): void {
  dequeueByUserId(entry.userId);
  queue.push(entry);
}

export function dequeueByUserId(userId: string): void {
  queue = queue.filter((e) => e.userId !== userId);
}

export function dequeueBySocketId(socketId: string): void {
  queue = queue.filter((e) => e.socketId !== socketId);
}

export function tryMatch(): [QueueEntry, QueueEntry] | null {
  if (queue.length < 2) return null;
  return [queue.shift()!, queue.shift()!];
}

export function getQueueSize(): number {
  return queue.length;
}

export function resetQueue(): void {
  queue = [];
}
