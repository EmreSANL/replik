// Legacy room routes still target Cloudflare D1/R2. They are not used by the
// Supabase-backed room flow, but must be resolvable in the Vercel server build.
export const env = {
  get DB(): D1Database {
    throw new Error('Bu eski oda API yolu yalnızca Cloudflare üzerinde çalışır.');
  },
  get FILES(): R2Bucket {
    throw new Error('Bu eski kayıt API yolu yalnızca Cloudflare üzerinde çalışır.');
  },
};
