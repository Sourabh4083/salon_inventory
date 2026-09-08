import "dotenv/config";
import { testDatabaseUrl } from "./global-setup";

// Point every service at the isolated test database before any module loads Prisma.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-at-least-16-chars";
