import { parseFile } from "music-metadata";
import path from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import Music from './music_model.js';

const ALLOWED_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.aac', '.wav', '.ogg']);

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
  for (const filename of filenames) {
    const fullPath = path.resolve(targetDirectory, filename);
    const extension = path.extname(filename).toLowerCase();
    if (extension && !ALLOWED_EXTENSIONS.has(extension)) continue;
    const candidatePaths = Array.from(
      new Set([
        fullPath,
        path.normalize(path.join(targetDirectory, filename)),
        directory ? path.normalize(path.join(directory, filename)) : fullPath,
      ]),
    );

    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue; // skip directories

      const existingDocs = await Music.find({ path: { $in: candidatePaths } });

      let metadata = null;
      try {
        metadata = await parseFile(fullPath);
      } catch (metaError) {
        // ignore metadata parsing errors and fall back to filename-derived data
      }

      const parsedPath = path.parse(filename);
      const nextTitle = metadata?.common?.title || parsedPath.name;
      const nextArtist = metadata?.common?.artist || 'Unknown Artist';

      if (!existingDocs.length) {
        const musicEntry = new Music({
          title: nextTitle,
          artist: nextArtist,
          path: fullPath,
        });
        await musicEntry.save();
        console.log("Imported:", musicEntry.title);
        continue;
      }

      const canonicalDoc = existingDocs.find((doc) => doc.path === fullPath) || existingDocs[0];
      let needsSave = false;

      if (canonicalDoc.path !== fullPath) {
        canonicalDoc.path = fullPath;
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
}