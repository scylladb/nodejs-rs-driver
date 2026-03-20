export interface Authenticator {
  initialResponse(callback: Function): void;

  evaluateChallenge(challenge: Buffer, callback: Function): void;

  onAuthenticationSuccess(token?: Buffer): void;
}

export interface AuthProvider {
  newAuthenticator(endpoint: string, name: string): Authenticator;
}

export class PlainTextAuthProvider implements AuthProvider {
  constructor(username: string, password: string);

  newAuthenticator(endpoint: string, name: string): Authenticator;
}
