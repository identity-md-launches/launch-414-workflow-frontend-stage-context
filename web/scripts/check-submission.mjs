import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { root } from './common.mjs';
// Build a candidate Git submission entirely in disposable scratch space.
// The worker's actual .git directory is read-only and is never mutated.
const original = (...args) => execFileSync('git', args, {cwd:root,encoding:'utf8'}).trim();
await mkdir(root+'test/scratch',{recursive:true});
const scratch = await mkdtemp(root+'test/scratch/submission-');
const gitDir = scratch+'/candidate.git';
execFileSync('git',['init','--bare','--quiet',gitDir]);
const env = {...process.env,GIT_ALTERNATE_OBJECT_DIRECTORIES:original('rev-parse','--path-format=absolute','--git-path','objects')};
const git = (...args) => execFileSync('git',['--git-dir='+gitDir,'--work-tree='+root,...args],{cwd:root,env,encoding:'utf8'}).trim();
const base=original('rev-parse','HEAD');
git('update-ref','refs/heads/master',base);
git('read-tree',base);
// Earlier ancestry is incomplete in the worker mirror. Keep the deployed source
// commit and its entire tree, with that supplied commit as the history boundary.
await writeFile(gitDir+'/shallow',base+'\n');
git('add','--all','--','web','dist','docs');
const changed=git('diff','--cached','--name-only',base).split('\n');
for(const path of changed){
 assert(/^(web|dist|docs)\//.test(path),'Out-of-scope path: '+path);
 assert(!/(^|\/)(node_modules|\.npm|\.pnpm-store|\.cache|\.vite|vendor)(\/|$)/.test(path),'Dependency/cache path: '+path);
 assert(!path.endsWith('.tgz'),'Dependency archive: '+path);
 if(path.split('/').some(p=>p.startsWith('.')))assert.equal(path,'web/.gitignore');
}
assert((await stat(root+'web/.gitignore')).size<=1024);
assert(!git('ls-files','--stage').split('\n').some(line=>line.startsWith('160000')),'Submodule detected');
git('-c','user.name=Frontend validation','-c','user.email=frontend-validation@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','Validate frontend source and static export');
const bundle=scratch+'/submission.bundle';
git('bundle','create',bundle,'HEAD');
const bytes=(await stat(bundle)).size;
assert(bytes<=8388608,`Git bundle exceeds 8 MiB: ${bytes}`);
console.log(JSON.stringify({passed:true,baseCommit:base,candidateCommit:git('rev-parse','HEAD'),bundleBytes:bytes,limitBytes:8388608,changedPaths:changed.length,scope:'web/**, dist/**, docs/**; web/.gitignore <= 1024 bytes',scratchBundle:bundle,workspaceGitUnmodified:original('rev-parse','HEAD')===base},null,2));
