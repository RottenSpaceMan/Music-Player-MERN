import { parseFile } from "music-metadata";
import path from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import Music from './music_model.js';

const ALLOWED_EXTENSIONS = new Set(['.mp3']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_LIBRARY_DIR = path.resolve(__dirname, '../Music');

function resolveTargetDirectory(directory) {
  if (!directory) {
    return DEFAULT_LIBRARY_DIR;
  }
  if (path.isAbsolute(directory)) {
    return path.normalize(directory);
  }
  return path.resolve(DEFAULT_LIBRARY_DIR, directory);
}

function isWithinDirectory(candidatePath, directory) {
  const relative = path.relative(directory, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function deriveArtistTitleFromName(name) {
  const separators = [' - ', ' – ', ' — ', '-', '–', '—'];
  for (const separator of separators) {
    const marker = separator.trim();
    if (!name.includes(marker)) continue;
    const pieces = name.split(separator).map((piece) => piece.trim()).filter(Boolean);
    if (pieces.length >= 2) {
      return {
        artist: pieces[0],
        title: pieces.slice(1).join(separator.includes(' ') ? ' - ' : ' '),
      };
    }
  }
  return null;
}

export async function importToDb(directory) {
  const targetDirectory = resolveTargetDirectory(directory);

  if (!existsSync(targetDirectory)) {
    throw new Error(`Directory not found: ${targetDirectory}`);
  }

  const directoryStat = statSync(targetDirectory);
  if (!directoryStat.isDirectory()) {
    throw new Error(`Not a directory: ${targetDirectory}`);
  }

  const filenames = readdirSync(targetDirectory);
  const scannedPaths = new Set();

  for (const filename of filenames) {
    const fullPath = path.resolve(targetDirectory, filename);
    const normalizedFullPath = path.normalize(fullPath);
    const extension = path.extname(filename).toLowerCase();
    if (!extension || !ALLOWED_EXTENSIONS.has(extension)) continue;

    let fileStat;
    try {
      fileStat = statSync(normalizedFullPath);
    } catch (error) {
      console.error(`Unable to access file ${normalizedFullPath}:`, error.message);
      continue;
    }

    if (!fileStat.isFile()) continue;
    scannedPaths.add(normalizedFullPath);

    const candidatePaths = Array.from(
      new Set([
        normalizedFullPath,
        path.normalize(path.join(targetDirectory, filename)),
        directory ? path.normalize(path.join(directory, filename)) : normalizedFullPath,
      ]),
    );

    try {
      const existingDocs = await Music.find({ path: { $in: candidatePaths } });

      let metadata = null;
      try {
        metadata = await parseFile(normalizedFullPath);
      } catch (metaError) {
        // ignore metadata parsing errors and fall back to filename-derived data
      }

      const parsedPath = path.parse(filename);
      const fallbackFromName = deriveArtistTitleFromName(parsedPath.name);
      const parentDir = path.basename(path.dirname(normalizedFullPath));
      const rootDirName = path.basename(targetDirectory);
      const directoryArtist = parentDir && parentDir !== rootDirName ? parentDir : null;
      const metaArtists = metadata?.common?.artists;
      const metaArtist = metadata?.common?.artist
        || metadata?.common?.albumartist
        || (Array.isArray(metaArtists) ? metaArtists.find(Boolean) : null);
      const metaTitle = metadata?.common?.title;

      const nextTitle = metaTitle || fallbackFromName?.title || parsedPath.name;
      const nextArtist = metaArtist || fallbackFromName?.artist || directoryArtist || 'Unknown Artist';

      if (!existingDocs.length) {
        const musicEntry = new Music({
          title: nextTitle,
          artist: nextArtist,
          path: normalizedFullPath,
        });
        await musicEntry.save();
        console.log("Imported:", musicEntry.title);
        continue;
      }

      const canonicalDoc = existingDocs.find((doc) => path.normalize(doc.path) === normalizedFullPath) || existingDocs[0];
      let needsSave = false;

      if (path.normalize(canonicalDoc.path) !== normalizedFullPath) {
        canonicalDoc.path = normalizedFullPath;
        needsSave = true;
      }

      if (!canonicalDoc.title || canonicalDoc.title === filename) {
        canonicalDoc.title = nextTitle;
        needsSave = true;
      }

      if (!canonicalDoc.artist || canonicalDoc.artist === 'Unknown Artist') {
        canonicalDoc.artist = nextArtist;
        needsSave = true;
      }

      if (needsSave) {
        await canonicalDoc.save();
        console.log("Updated metadata for:", canonicalDoc.title);
      }

      const duplicates = existingDocs.filter((doc) => doc._id.toString() !== canonicalDoc._id.toString());
      if (duplicates.length) {
        await Music.deleteMany({ _id: { $in: duplicates.map((doc) => doc._id) } });
        console.log("Removed duplicate entries for:", canonicalDoc.title);
      }
    } catch (error) {
      console.error("Error importing", filename, ":", error.message);
    }
  }

  const allDocs = await Music.find({}).lean();
  const removals = [];
  const removedTitles = [];

  for (const doc of allDocs) {
    const docPath = path.normalize(doc.path);
    if (!isWithinDirectory(docPath, targetDirectory)) continue;

    const ext = path.extname(docPath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      removals.push(doc._id);
      removedTitles.push(doc.title || docPath);
      continue;
    }

    if (!existsSync(docPath)) {
      removals.push(doc._id);
      removedTitles.push(doc.title || docPath);
      continue;
    }

    let currentStat;
    try {
      currentStat = statSync(docPath);
    } catch (error) {
      removals.push(doc._id);
      removedTitles.push(doc.title || docPath);
      continue;
    }

    if (!currentStat.isFile()) {
      removals.push(doc._id);
      removedTitles.push(doc.title || docPath);
      continue;
    }

    if (!scannedPaths.has(docPath)) {
      removals.push(doc._id);
      removedTitles.push(doc.title || docPath);
    }
  }

  if (removals.length) {
    await Music.deleteMany({ _id: { $in: removals } });
    console.log("Removed stale entries:", removedTitles.join(', '));
  }
}