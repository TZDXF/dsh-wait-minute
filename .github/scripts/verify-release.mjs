#!/usr/bin/env node
// 发布标签校验：确认“标签 == package.json 版本”，并确认标签提交来自默认分支。
// 只读取环境变量、package.json 和 git 历史，不修改仓库内容。
//
// 环境变量：
//   RELEASE_TAG         github.ref_name，例如 v1.0.0
//   RELEASE_REF         github.ref，例如 refs/tags/v1.0.0
//   RELEASE_BASE_BRANCH 默认分支名，默认 master
//   GITHUB_OUTPUT       Actions 输出文件；本地运行可省略
// 输出：version / tag / tarball 三个 output。

import { appendFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const problems = [];
const note = (message) => console.log(`verify-release: ${message}`);
const fail = (message) => {
  console.error(`::error::${message}`);
  process.exit(1);
};

const tag = (process.env.RELEASE_TAG ?? '').trim();
const ref = (process.env.RELEASE_REF ?? '').trim();
const baseBranch = (process.env.RELEASE_BASE_BRANCH ?? 'master').trim();

if (!tag) fail('缺少 RELEASE_TAG（应为 github.ref_name），无法确认要发布的版本。');
if (!ref) fail('缺少 RELEASE_REF（应为 github.ref），无法确认触发来源。');

// 只接受 v<major>.<minor>.<patch>，可带预发布或构建后缀。
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
if (!TAG_PATTERN.test(tag)) {
  fail(`标签 ${tag} 不是版本标签：请使用 v1.0.0 或 v1.0.0-beta.1 这类形式。`);
}

const version = tag.slice(1);

if (ref !== `refs/tags/${tag}`) {
  fail(`触发来源 ${ref} 与标签 ${tag} 不一致：本流程只允许由版本标签推送触发。`);
}

let manifest = null;
try {
  manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
} catch (error) {
  fail(`无法读取 package.json：${error.message}`);
}

if (manifest.version !== version) {
  problems.push(
    `package.json 版本 ${manifest.version} 与标签 ${tag} 不一致：` +
      '请先把 package.json 的 version 改成目标版本并提交，再创建标签。',
  );
}
if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
  problems.push('package.json 缺少 name，无法确定安装包名称。');
}
if (manifest.private === true) {
  problems.push('package.json 标记了 "private": true，不能作为发布包。');
}
if (!manifest.dsh?.bundle || !manifest.dsh?.client) {
  problems.push('package.json 缺少 dsh.bundle / dsh.client，安装包不会被 DSH 当作插件加载。');
}

const packaged = Array.isArray(manifest.files) ? manifest.files.map((entry) => String(entry).replace(/\/+$/, '')) : [];
if (!packaged.includes('lib')) {
  problems.push('package.json 的 files 未包含 lib/，构建出的客户端 bundle 不会进入安装包。');
}
if (!packaged.includes('src')) {
  problems.push('package.json 的 files 未包含 src/，安装包会缺少宿主端代码。');
}

// 标签必须落在默认分支历史上，避免从临时分支直接发布。
const git = (args) => spawnSync('git', args, { encoding: 'utf8' });
const remoteRef = `origin/${baseBranch}`;
if (git(['rev-parse', '--verify', '--quiet', remoteRef]).status !== 0) {
  console.log(`::warning::verify-release: 未找到 ${remoteRef}，跳过“标签必须位于默认分支历史中”的检查。`);
} else if (git(['merge-base', '--is-ancestor', 'HEAD', remoteRef]).status !== 0) {
  problems.push(`标签 ${tag} 指向的提交不在 ${remoteRef} 的历史中：请从默认分支上的提交打标签。`);
} else {
  note(`标签提交已包含在 ${baseBranch} 的历史中。`);
}

const tarball = `${manifest.name.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;

if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  console.error(`verify-release: 校验失败，共 ${problems.length} 项，未发布任何内容。`);
  process.exit(1);
}

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `${Object.entries({ version, tag, tarball }).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
  );
}

note(`校验通过：标签 ${tag}，安装包 ${tarball}。`);
