/** The server answered the request with an AppError (e.g. "no_player", "not_found", "rate_limit"). */
export class RustPlusError extends Error {
  constructor(
    readonly code: string,
    readonly request?: string,
  ) {
    super(request ? `Rust+ error "${code}" for ${request}` : `Rust+ error "${code}"`);
    this.name = 'RustPlusError';
  }
}

export class RequestTimeoutError extends Error {
  constructor(
    readonly request: string,
    readonly timeoutMs: number,
  ) {
    super(`No response to ${request} within ${timeoutMs} ms`);
    this.name = 'RequestTimeoutError';
  }
}

export class NotConnectedError extends Error {
  constructor(message = 'Not connected to a Rust+ server') {
    super(message);
    this.name = 'NotConnectedError';
  }
}

/** The WebSocket handshake was refused (relay returned a non-101 HTTP status). */
export class HandshakeError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Rust+ connection refused: HTTP ${status}${body ? ` - ${body.slice(0, 200)}` : ''}`);
    this.name = 'HandshakeError';
  }
}
