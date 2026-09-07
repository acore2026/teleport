import type { LucideIcon } from "lucide-react";
import {
  Clipboard,
  FileArchive,
  FileAudio,
  FileCode2,
  File as FileIcon,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
} from "lucide-react";
import type { RoomItem } from "../types";

function fileExtension(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match?.[1]?.toLowerCase() || "";
}

export function fileIconFor(item: RoomItem): { Icon: LucideIcon; tone: string; label: string } {
  if (item.type === "text") return { Icon: Clipboard, tone: "text", label: "text" };

  const extension = fileExtension(item.fileName);
  const mime = item.mimeType || "";
  const image = ["avif", "gif", "heic", "jpeg", "jpg", "png", "svg", "webp"];
  const video = ["avi", "m4v", "mkv", "mov", "mp4", "webm"];
  const audio = ["aac", "flac", "m4a", "mp3", "ogg", "wav"];
  const archive = ["7z", "bz2", "gz", "rar", "tar", "tgz", "zip"];
  const sheet = ["csv", "ods", "tsv", "xls", "xlsx"];
  const code = ["c", "cpp", "css", "go", "html", "java", "js", "jsx", "py", "rs", "sh", "ts", "tsx"];
  const json = ["json", "jsonl", "map"];
  const text = ["log", "md", "rtf", "txt", "yaml", "yml"];

  if (image.includes(extension) || mime.startsWith("image/"))
    return { Icon: FileImage, tone: "image", label: extension || "image" };
  if (video.includes(extension) || mime.startsWith("video/"))
    return { Icon: FileVideo, tone: "video", label: extension || "video" };
  if (audio.includes(extension) || mime.startsWith("audio/"))
    return { Icon: FileAudio, tone: "audio", label: extension || "audio" };
  if (archive.includes(extension)) return { Icon: FileArchive, tone: "archive", label: extension };
  if (sheet.includes(extension)) return { Icon: FileSpreadsheet, tone: "sheet", label: extension };
  if (json.includes(extension)) return { Icon: FileJson, tone: "json", label: extension };
  if (code.includes(extension)) return { Icon: FileCode2, tone: "code", label: extension };
  if (text.includes(extension) || mime.startsWith("text/"))
    return { Icon: FileText, tone: "document", label: extension || "text" };

  return { Icon: FileIcon, tone: "file", label: extension || "file" };
}

export function isPreviewableImage(item: RoomItem) {
  return item.type === "file" && item.mimeType.startsWith("image/");
}
