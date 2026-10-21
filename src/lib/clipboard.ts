function extensionForMime(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/svg+xml") return "svg";
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.trim().toLowerCase();
  return subtype && /^[a-z0-9]+$/.test(subtype) ? subtype : "png";
}

function namedClipboardFile(file: File, index: number) {
  if (file.name && file.name !== "image.png") return file;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = file.type.startsWith("image/") ? "pasted-image" : "pasted-file";
  return new File(
    [file],
    `${prefix}-${stamp}${index ? `-${index + 1}` : ""}.${extensionForMime(file.type)}`,
    {
      type: file.type || "application/octet-stream",
      lastModified: Date.now(),
    },
  );
}

export function filesFromClipboard(data: DataTransfer) {
  const files = Array.from(data.files || []);
  if (files.length) return files.map(namedClipboardFile);

  return Array.from(data.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
    .map(namedClipboardFile);
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const shim = document.createElement("textarea");
  shim.value = text;
  shim.setAttribute("readonly", "");
  shim.className = "copy-shim";
  document.body.append(shim);
  shim.select();
  document.execCommand("copy");
  shim.remove();
}
