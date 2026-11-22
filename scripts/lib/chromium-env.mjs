/**
 * 컨테이너에 libnss3·libatk 등 시스템 라이브러리가 없을 때, 추출해 둔 로컬 라이브러리를
 * LD_LIBRARY_PATH 앞에 붙인다. 라이브러리가 시스템에 있으면 아무 일도 하지 않는다.
 *   사용: 브라우저를 띄우는 스크립트에서 `import './lib/chromium-env.mjs';` 를 가장 먼저 둔다.
 */
import { existsSync } from 'node:fs';

const CANDIDATES = ['/workspace/.deps/root', '/workspace/.libs/root'];
const SUPERS = ['usr/lib/x86_64-linux-gnu', 'lib/x86_64-linux-gnu'];

for (const root of CANDIDATES) {
  if (!SUPERS.some((sub) => existsSync(`${root}/${sub}`))) continue;
  const dirs = SUPERS.map((sub) => `${root}/${sub}`).filter((d) => existsSync(d));
  process.env.LD_LIBRARY_PATH = [...dirs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  break;
}
