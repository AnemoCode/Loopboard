import type { Problem } from '@cld/shared';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(title);
  }

  problem(): Problem {
    return {
      title: this.title,
      status: this.status,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }
}
