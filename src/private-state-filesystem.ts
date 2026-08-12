import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync
} from "node:fs";
import type { Stats } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep
} from "node:path";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const OPEN_DIRECTORY = constants.O_DIRECTORY ?? 0;

export class PrivateStatePathError extends Error {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PrivateStatePathError";
  }
}

export interface SecureDirectoryIdentity {
  readonly path: string;
  readonly device: number;
  readonly inode: number;
}

export interface SecureDatabaseIdentity {
  readonly path: string;
  readonly directory: SecureDirectoryIdentity;
  readonly device: number;
  readonly inode: number;
}

export interface ProjectScoreState {
  readonly scoreDirectory: SecureDirectoryIdentity;
  readonly reviewsDirectory: SecureDirectoryIdentity;
  readonly database: SecureDatabaseIdentity;
}

function missingPath(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException).code === "ENOENT";
}

function pathStatus(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (cause) {
    if (missingPath(cause)) return undefined;
    throw cause;
  }
}

function sameIdentity(
  left: { readonly dev: number; readonly ino: number },
  right: { readonly dev: number; readonly ino: number }
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function pathIsInside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function assertInside(root: string, path: string, label: string): void {
  if (!pathIsInside(root, path)) {
    throw new PrivateStatePathError(`${label} must remain inside its canonical state directory`);
  }
}

function directoryIdentity(
  path: string,
  label: string,
  options: {
    readonly privateMode: "tighten" | "require" | "ignore";
    readonly containmentRoot?: string;
  }
): SecureDirectoryIdentity {
  const before = lstatSync(path);
  if (before.isSymbolicLink()) {
    throw new PrivateStatePathError(`${label} must not be a symbolic link`);
  }
  if (!before.isDirectory()) {
    throw new PrivateStatePathError(`${label} must be a directory`);
  }
  const canonical = realpathSync(path);
  if (options.containmentRoot !== undefined) {
    assertInside(options.containmentRoot, canonical, label);
  }
  const canonicalStatus = statSync(canonical);
  if (!sameIdentity(before, canonicalStatus)) {
    throw new PrivateStatePathError(`${label} changed while SCORE inspected it`);
  }

  const descriptor = openSync(canonical, constants.O_RDONLY | OPEN_DIRECTORY | NO_FOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isDirectory() || !sameIdentity(before, opened)) {
      throw new PrivateStatePathError(`${label} changed while SCORE secured it`);
    }
    if (options.privateMode === "tighten" && process.platform !== "win32") {
      fchmodSync(descriptor, PRIVATE_DIRECTORY_MODE);
    }
    if (
      options.privateMode === "require" &&
      process.platform !== "win32" &&
      (opened.mode & 0o777) !== PRIVATE_DIRECTORY_MODE
    ) {
      throw new PrivateStatePathError(`${label} permissions must be 0700`);
    }
  } finally {
    closeSync(descriptor);
  }

  const after = lstatSync(canonical);
  if (after.isSymbolicLink() || !after.isDirectory() || !sameIdentity(before, after)) {
    throw new PrivateStatePathError(`${label} changed while SCORE secured it`);
  }
  if (
    options.privateMode !== "ignore" &&
    process.platform !== "win32" &&
    (after.mode & 0o777) !== PRIVATE_DIRECTORY_MODE
  ) {
    throw new PrivateStatePathError(`${label} permissions must be 0700`);
  }
  return { path: canonical, device: after.dev, inode: after.ino };
}

export function assertSecureDirectoryIdentity(
  identity: SecureDirectoryIdentity,
  label: string
): void {
  const status = lstatSync(identity.path);
  if (
    status.isSymbolicLink() ||
    !status.isDirectory() ||
    status.dev !== identity.device ||
    status.ino !== identity.inode
  ) {
    throw new PrivateStatePathError(`${label} changed during the state operation`);
  }
}

function createOwnedDirectory(
  path: string,
  parent: SecureDirectoryIdentity,
  label: string
): SecureDirectoryIdentity {
  assertSecureDirectoryIdentity(parent, "State directory parent");
  assertInside(parent.path, path, label);
  if (pathStatus(path) === undefined) {
    try {
      mkdirSync(path, { mode: PRIVATE_DIRECTORY_MODE });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
    }
  }
  const identity = directoryIdentity(path, label, {
    privateMode: "tighten",
    containmentRoot: parent.path
  });
  assertSecureDirectoryIdentity(parent, "State directory parent");
  return identity;
}

function nearestExistingDirectory(path: string): {
  readonly directory: string;
  readonly missingNames: ReadonlyArray<string>;
} {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const names = relative(root, absolute).split(sep).filter(Boolean);
  let lexical = root;
  let canonical = realpathSync(root);
  const trustedMacOsAliases = new Map([
    ["/etc", "/private/etc"],
    ["/tmp", "/private/tmp"],
    ["/var", "/private/var"]
  ]);
  for (const [index, name] of names.entries()) {
    lexical = join(lexical, name);
    const status = pathStatus(lexical);
    if (status === undefined) {
      return { directory: canonical, missingNames: names.slice(index) };
    }
    if (status.isSymbolicLink()) {
      const canonicalTarget = realpathSync(lexical);
      const trustedSystemAlias =
        process.platform === "darwin" &&
        status.uid === 0 &&
        trustedMacOsAliases.get(lexical) === canonicalTarget;
      if (!trustedSystemAlias) {
        throw new PrivateStatePathError(
          "Runner database parent chain must not contain a symbolic link"
        );
      }
      const target = statSync(lexical);
      if (!target.isDirectory()) {
        throw new PrivateStatePathError("Runner database parent must be a directory");
      }
    } else if (!status.isDirectory()) {
      throw new PrivateStatePathError("Runner database parent must be a directory");
    }
    canonical = realpathSync(lexical);
  }
  return { directory: canonical, missingNames: [] };
}

export function preparePrivateDatabaseDirectory(input: {
  readonly databasePath: string;
  readonly label: string;
  readonly tightenExisting: boolean;
}): { readonly databasePath: string; readonly directory: SecureDirectoryIdentity } {
  if (input.databasePath === ":memory:") {
    throw new PrivateStatePathError(":memory: does not have a filesystem directory");
  }
  const absoluteDatabasePath = resolve(input.databasePath);
  const requestedParent = dirname(absoluteDatabasePath);
  const { directory: existingPath, missingNames } = nearestExistingDirectory(requestedParent);
  let current = directoryIdentity(
    existingPath,
    missingNames.length === 0 ? `${input.label} parent` : `${input.label} ancestor`,
    {
      privateMode: "ignore"
    }
  );
  for (const name of missingNames) {
    current = createOwnedDirectory(join(current.path, name), current, `${input.label} parent`);
  }
  if (missingNames.length === 0) {
    current = directoryIdentity(requestedParent, `${input.label} parent`, {
      privateMode: input.tightenExisting ? "tighten" : "require"
    });
  }
  return {
    databasePath: join(current.path, basename(absoluteDatabasePath)),
    directory: current
  };
}

function secureRegularFile(
  path: string,
  directory: SecureDirectoryIdentity,
  label: string,
  create: boolean,
  allowMultipleLinks = false
): { readonly device: number; readonly inode: number } | undefined {
  assertSecureDirectoryIdentity(directory, `${label} parent`);
  assertInside(directory.path, path, label);
  const before = pathStatus(path);
  if (before === undefined && !create) {
    assertSecureDirectoryIdentity(directory, `${label} parent`);
    return undefined;
  }
  if (before?.isSymbolicLink()) {
    throw new PrivateStatePathError(`${label} must not be a symbolic link`);
  }
  if (
    before !== undefined &&
    (!before.isFile() || (!allowMultipleLinks && before.nlink !== 1))
  ) {
    throw new PrivateStatePathError(`${label} must be one regular file`);
  }

  let flags = before === undefined
    ? constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW
    : constants.O_RDWR | NO_FOLLOW;
  let descriptor: number;
  try {
    try {
      descriptor = openSync(path, flags, PRIVATE_FILE_MODE);
    } catch (cause) {
      if (
        before === undefined &&
        create &&
        (cause as NodeJS.ErrnoException).code === "EEXIST"
      ) {
        const raced = pathStatus(path);
        if (
          raced === undefined ||
          raced.isSymbolicLink() ||
          !raced.isFile() ||
          (!allowMultipleLinks && raced.nlink !== 1)
        ) {
          throw new PrivateStatePathError(`${label} changed while SCORE created it`);
        }
        flags = constants.O_RDWR | NO_FOLLOW;
        descriptor = openSync(path, flags, PRIVATE_FILE_MODE);
      } else {
        throw cause;
      }
    }
  } catch (cause) {
    throw new PrivateStatePathError(`${label} could not be opened safely`, { cause });
  }
  let opened: Stats;
  try {
    opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      (!allowMultipleLinks && opened.nlink !== 1) ||
      (before !== undefined && !sameIdentity(before, opened))
    ) {
      throw new PrivateStatePathError(`${label} changed while SCORE opened it`);
    }
    if (process.platform !== "win32") fchmodSync(descriptor, PRIVATE_FILE_MODE);
  } finally {
    closeSync(descriptor);
  }

  const after = lstatSync(path);
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    (!allowMultipleLinks && after.nlink !== 1) ||
    !sameIdentity(opened!, after)
  ) {
    throw new PrivateStatePathError(`${label} changed while SCORE secured it`);
  }
  if (process.platform !== "win32" && (after.mode & 0o777) !== PRIVATE_FILE_MODE) {
    throw new PrivateStatePathError(`${label} permissions must be 0600`);
  }
  assertSecureDirectoryIdentity(directory, `${label} parent`);
  return { device: after.dev, inode: after.ino };
}

function assertPrivateSqliteSidecar(status: Stats, label: string): void {
  if (status.isSymbolicLink()) {
    throw new PrivateStatePathError(`${label} must not be a symbolic link`);
  }
  if (!status.isFile() || status.nlink !== 1) {
    throw new PrivateStatePathError(`${label} must be one regular file`);
  }
  if (process.platform !== "win32" && (status.mode & 0o777) !== PRIVATE_FILE_MODE) {
    throw new PrivateStatePathError(`${label} permissions must be 0600`);
  }
}

/**
 * SQLite sidecars are ephemeral: another connection may delete or replace a
 * journal between any two observations. They are created with the database's
 * 0600 mode inside its 0700 directory, so SCORE only validates them here. In
 * particular, it must not open or chmod a WAL or journal that another process
 * may currently have mapped.
 */
function validateSqliteSidecar(
  path: string,
  directory: SecureDirectoryIdentity,
  label: string
): void {
  assertSecureDirectoryIdentity(directory, `${label} parent`);
  assertInside(directory.path, path, label);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const before = pathStatus(path);
    if (before === undefined) {
      assertSecureDirectoryIdentity(directory, `${label} parent`);
      return;
    }
    assertPrivateSqliteSidecar(before, label);

    const after = pathStatus(path);
    if (after === undefined) {
      assertSecureDirectoryIdentity(directory, `${label} parent`);
      return;
    }
    assertPrivateSqliteSidecar(after, label);
    if (sameIdentity(before, after)) {
      assertSecureDirectoryIdentity(directory, `${label} parent`);
      return;
    }
  }

  throw new PrivateStatePathError(`${label} kept changing while SCORE inspected it`);
}

export function preparePrivateDatabase(input: {
  readonly databasePath: string;
  readonly directory: SecureDirectoryIdentity;
  readonly label: string;
  readonly create: boolean;
}): SecureDatabaseIdentity | undefined {
  const identity = secureRegularFile(
    input.databasePath,
    input.directory,
    input.label,
    input.create
  );
  return identity === undefined
    ? undefined
    : { path: input.databasePath, directory: input.directory, ...identity };
}

export function prepareRunnerDatabaseState(input: {
  readonly databasePath: string;
  readonly tightenExistingParent: boolean;
  readonly createDatabase: boolean;
}): {
  readonly databasePath: string;
  readonly directory: SecureDirectoryIdentity;
  readonly database?: SecureDatabaseIdentity;
} {
  const location = preparePrivateDatabaseDirectory({
    databasePath: input.databasePath,
    label: "Runner database",
    tightenExisting: input.tightenExistingParent
  });
  const database = preparePrivateDatabase({
    databasePath: location.databasePath,
    directory: location.directory,
    label: "Runner database",
    create: input.createDatabase
  });
  if (database !== undefined) secureSqliteSidecars(database, "Runner database");
  return {
    ...location,
    ...(database === undefined ? {} : { database })
  };
}

export function assertSecureDatabaseIdentity(
  identity: SecureDatabaseIdentity,
  label: string
): void {
  assertSecureDirectoryIdentity(identity.directory, `${label} parent`);
  const status = lstatSync(identity.path);
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    status.nlink !== 1 ||
    status.dev !== identity.device ||
    status.ino !== identity.inode
  ) {
    throw new PrivateStatePathError(`${label} changed during the database operation`);
  }
}

export function secureSqliteSidecars(
  database: SecureDatabaseIdentity,
  label: string
): void {
  assertSecureDatabaseIdentity(database, label);
  for (const suffix of ["-journal", "-shm", "-wal"] as const) {
    validateSqliteSidecar(
      `${database.path}${suffix}`,
      database.directory,
      `${label}${suffix}`
    );
  }
  assertSecureDatabaseIdentity(database, label);
}

export function prepareProjectScoreState(projectRoot: string): ProjectScoreState {
  const root = directoryIdentity(realpathSync(projectRoot), "Project root", {
    privateMode: "ignore"
  });
  const scoreDirectory = createOwnedDirectory(
    join(root.path, ".score"),
    root,
    "SCORE state directory"
  );
  const reviewsDirectory = createOwnedDirectory(
    join(scoreDirectory.path, "reviews"),
    scoreDirectory,
    "SCORE reviews directory"
  );
  const databasePath = join(scoreDirectory.path, "score.db");
  const database = preparePrivateDatabase({
    databasePath,
    directory: scoreDirectory,
    label: "SCORE database",
    create: true
  });
  if (database === undefined) {
    throw new PrivateStatePathError("SCORE database could not be created");
  }
  for (const suffix of ["-journal", "-shm", "-wal"] as const) {
    validateSqliteSidecar(
      `${databasePath}${suffix}`,
      scoreDirectory,
      `SCORE database${suffix}`
    );
  }
  return { scoreDirectory, reviewsDirectory, database };
}

export function securePublishedFile(
  path: string,
  directory: SecureDirectoryIdentity,
  label: string
): void {
  const secured = secureRegularFile(path, directory, label, false, true);
  if (secured === undefined) {
    throw new PrivateStatePathError(`${label} is missing after publication`);
  }
}
