import { mkdir, rm, writeFile } from 'node:fs/promises'

await mkdir('dist',{recursive:true})
await writeFile('dist/.assetsignore','_redirects\n','utf8')
await rm('worker',{recursive:true,force:true})
