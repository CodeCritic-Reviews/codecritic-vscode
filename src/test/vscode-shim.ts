/** Minimal vscode shim for Vitest (extension host APIs not available in Node). */
export class CancellationError extends Error {
  constructor(message = 'Canceled') {
    super(message);
    this.name = 'Canceled';
  }
}

export type CancellationToken = {
  isCancellationRequested: boolean;
};

export type Uri = {
  fsPath: string;
  toString(): string;
};
