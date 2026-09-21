export async function resolveKnowledgeImages(
  storedImages: string[],
  bucket?: R2Bucket,
): Promise<string[]> {
  const resolved = await Promise.all(storedImages.slice(0, 10).map(async (stored) => {
    if (/^data:image\/(png|jpeg|webp);base64,/i.test(stored)) return stored;
    if (!stored.startsWith('r2:kb/') || !bucket) return null;
    const object = await bucket.get(stored.slice(3));
    if (!object) return null;
    const contentType = object.httpMetadata?.contentType || '';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType) || object.size > 5_000_000) {
      await object.body.cancel();
      return null;
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return `data:${contentType};base64,${btoa(binary)}`;
  }));
  return resolved.filter((value): value is string => value !== null);
}
