/**
 * Seed or promote an administrator.
 *
 * Admin is not self-assignable through the public API, so this script is the
 * only way to create the first one.
 *
 *   node scripts/createAdmin.js --email you@example.com --password "secret123" --name "Your Name"
 *
 * If the email already exists the account is promoted to admin instead of
 * being duplicated.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { User, ROLES } from '../src/models/User.js';
import { logger } from '../src/utils/logger.js';

/** Parse `--key value` pairs from argv. */
const parseArgs = () => {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--/, '');
    if (key) args[key] = process.argv[i + 1];
  }
  return args;
};

const run = async () => {
  const { email, password, name } = parseArgs();

  if (!email || !password) {
    console.error('\n  Usage: node scripts/createAdmin.js --email <email> --password <password> [--name <name>]\n');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('\n  Password must be at least 8 characters.\n');
    process.exit(1);
  }

  await connectDatabase();

  const normalised = email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalised });

  if (existing) {
    existing.role = ROLES.ADMIN;
    existing.password = password; // re-hashed by the pre-save hook
    await existing.save();
    logger.success(`Promoted existing account to admin: ${existing.email}`);
  } else {
    const admin = await User.create({
      name: name || 'Administrator',
      email: normalised,
      password,
      role: ROLES.ADMIN,
    });
    logger.success(`Admin created: ${admin.email}`);
  }

  await disconnectDatabase();
  process.exit(0);
};

run().catch(async (err) => {
  logger.error('Failed to create admin:', err.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
