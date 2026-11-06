import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from './db/index.js';
import {
  account,
  projectInvites,
  projectMembers,
  session,
  user,
  verification,
} from './db/schema.js';
import type { Env } from './env.js';

export type Auth = ReturnType<typeof createAuth>;

export interface AuthHooks {
  /** Called when a guest signs up or signs in, before the guest user is deleted. */
  onGuestLinked?: (guestId: string, userId: string) => Promise<void>;
}

export function createAuth(env: Env, db: Db, hooks: AuthHooks = {}) {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)
    socialProviders.github = {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    };

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.PUBLIC_URL,
    basePath: '/api/auth',
    trustedOrigins: [env.PUBLIC_URL],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    socialProviders,
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: env.NODE_ENV === 'production' && !env.DISABLE_RATE_LIMIT,
      window: 60,
      max: 30,
    },
    telemetry: { enabled: false },
    plugins: [
      anonymous({
        // Placeholder addresses for guests; never shown or mailed.
        emailDomainName: 'guest.loopboard.invalid',
        generateName: () => 'Guest',
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await hooks.onGuestLinked?.(anonymousUser.user.id, newUser.user.id);
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          // People invited by email before they had an account join those projects on sign-up.
          after: async (created) => acceptEmailInvites(db, created.id, created.email),
        },
      },
    },
  });
}

export async function acceptEmailInvites(db: Db, userId: string, email: string) {
  const invites = await db
    .select()
    .from(projectInvites)
    .where(and(eq(projectInvites.email, email.toLowerCase()), isNull(projectInvites.token)));
  for (const inv of invites) {
    await db
      .insert(projectMembers)
      .values({ projectId: inv.projectId, userId, role: inv.role })
      .onConflictDoNothing();
    await db.delete(projectInvites).where(eq(projectInvites.id, inv.id));
  }
}
