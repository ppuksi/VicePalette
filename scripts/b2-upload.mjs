// Minimal Backblaze B2 uploader — no external CLI needed, pure Node fetch.
//
// Env:
//   B2_APPLICATION_KEY_ID   application key id (or "keyID")
//   B2_APPLICATION_KEY      application key
//   B2_API_BASE             override for tests (default https://api.backblazeb2.com)
//
// Returns the B2 file response object. Throws with a readable message on failure.

import { createHash } from 'node:crypto';
import fs from 'node:fs';

const B2_API = process.env.B2_API_BASE || 'https://api.backblazeb2.com';

export async function b2UploadFile({ keyId, appKey, bucketName, localPath, remotePath }) {
  const authRes = await fetch(`${B2_API}/b2api/v2/b2_authorize_account`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${keyId}:${appKey}`).toString('base64') },
  });
  if (!authRes.ok) {
    throw new Error(`b2 authorize failed (${authRes.status}): ${(await authRes.text()).slice(0, 300)}`);
  }
  const auth = await authRes.json();
  const { apiUrl, authorizationToken, allowed } = auth;
  if (!allowed || allowed.bucketName !== bucketName) {
    throw new Error(
      `b2 key is not scoped to bucket "${bucketName}" (key allows: ${allowed?.bucketName || 'nothing'}). ` +
        `Create a key restricted to the gallery bucket.`
    );
  }

  const upRes = await fetch(`${apiUrl}/b2api/v2/b2_get_upload_url?bucketId=${allowed.bucketId}`, {
    method: 'POST',
    headers: { Authorization: authorizationToken },
  });
  if (!upRes.ok) {
    throw new Error(`b2 get_upload_url failed (${upRes.status}): ${(await upRes.text()).slice(0, 300)}`);
  }
  const up = await upRes.json();

  const data = fs.readFileSync(localPath);
  const sha1 = createHash('sha1').update(data).digest('hex');
  // X-Bz-File-Name must be URL-encoded, but keep "/" as the path separator.
  const encodedName = encodeURIComponent(remotePath).replace(/%2F/g, '/');

  const fileRes = await fetch(up.uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: up.authorizationToken,
      'X-Bz-File-Name': encodedName,
      'X-Bz-Content-Sha1': sha1,
      'Content-Type': 'b2/x-auto',
    },
    body: data,
  });
  if (!fileRes.ok) {
    throw new Error(`b2 upload failed (${fileRes.status}): ${(await fileRes.text()).slice(0, 300)}`);
  }
  return fileRes.json();
}
