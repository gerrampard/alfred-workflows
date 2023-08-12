const fs = require('fs');
const {execSync} = require('child_process');
const path = require('path');
const plist = require('plist');
const [, , action] = process.argv;
const querystring = require('querystring');

/**
 * 输出workflow-name到固定文件，CI需要,之后走CI解析yaml，做到动态更新
 * @param items
 */
function writeWorkflowNameOptions(items) {
  fs.writeFileSync(path.join(__dirname, '../..', 'workflow_name_options.txt',), items.reduce((res, workflow) => res += `- ${workflow.name}\n`, ''), {
    encoding: 'utf8'
  });
}

/**
 * 更新仓库readme，包含中英文
 * github 缺省环境变量
 * https://docs.github.com/en/enterprise-cloud@latest/actions/learn-github-actions/environment-variables#default-environment-variables
 *
 * @param {{name,path}[]} items
 */
function updateHomeReadme(items) {
  ['README.md', 'README-zh.md'].forEach((filename) => {
    const isEn = filename === 'README.md';
    const filePath = path.resolve(__dirname, '../../', filename);
    let readmeContent = fs.readFileSync(filePath, 'utf8');
    const workflowList = [isEn ? `There are ${items.length} workflows` : `共${items.length}个`,
      ...items.map((item, index) => {
        const arr = [];
        arr.push(`\n### ${index + 1}. [${item.name}](https://github.com/alanhg/alfred-workflows${(item.path)})`);
        item.plistObj.description && arr.push(`> ${item.plistObj.description}`);
        arr.push(`${buildBadgeContent(item.plistObj, item.folderName, item.filename)}`);
        return arr.join('\n');
      })];
    const workflowsListStr = workflowList.join('\n');
    const newReadmeContent = readmeContent.replace(/(?<=<!--workflow-start-->)[\s\S]*(?=<!--workflow-end-->)/, workflowsListStr)
    fs.writeFileSync(filePath, newReadmeContent);
  })
}

/**
 * 保存workflow源码文件，方便PR对比
 * @param workflowFolder
 * @param workflow
 * @returns {{plistObj: *}}
 */
function parseWorkflowInfo(workflowFolder) {
  if (fs.existsSync(`${workflowFolder}/src/info.plist`)) {
    const plistObj = plist.parse(fs.readFileSync(`${workflowFolder}/src/info.plist`, 'utf8'));
    return {plistObj};
  } else {
    throw new Error(`workflow ${workflowFolder} not found info.plist`);
  }
}

function updateHomePage() {
  const targetFolder = path.resolve(__dirname, '../../');
  const folders = fs.readdirSync(targetFolder);
  const items = [];
  folders.forEach((folderName) => {
    const workflowFolder = targetFolder + '/' + folderName;
    const stat = fs.lstatSync(workflowFolder);
    if (stat.isFile()) {
      return;
    }
    if (folderName.match(/(^\.)|node_modules/)) {
      return;
    }
    try {
      const {plistObj} = parseWorkflowInfo(workflowFolder);
      items.push({
        name: plistObj.name, path: `/tree/master/${folderName}`, folderName, plistObj,
        filename: querystring.escape(plistObj.name + '.alfredworkflow')
      });
    } catch (e) {
      console.log(e);
    }
  });
  updateHomeReadme(items);
  writeWorkflowNameOptions(items);
}

/**
 * github 缺省环境变量
 * https://docs.github.com/en/enterprise-cloud@latest/actions/learn-github-actions/environment-variables#default-environment-variables
 * @param absoluteWorkflowFolder
 * @param folderName
 * @param plistObj
 */
function updateReadme(absoluteWorkflowFolder, folderName, plistObj) {
  const readme = plistObj.readme;
  const readmeFile = absoluteWorkflowFolder + '/README.md';
  const filename = plistObj.name + '.alfredworkflow';
  let readmeContent;
  try {
    if (!fs.existsSync(readmeFile)) {
      readmeContent = `

<!-- more -->`;
    } else {
      readmeContent = fs.readFileSync(readmeFile, 'utf8');
    }

    const badgeContent = `${readme}\n\n
${buildBadgeContent(plistObj, folderName, querystring.escape(filename))}
\n\n`;
    readmeContent = readmeContent.replace(/(^(\s|\S)+)?(?=<!-- more -->)/, '');
    readmeContent = badgeContent + readmeContent;
    fs.writeFileSync(readmeFile, readmeContent);
  } catch (e) {
    console.log(e);
  }
}

function buildBadgeContent({version}, folderName, filename) {

  return `
![](https://img.shields.io/badge/version-v${version}-green?style=for-the-badge)
[![](https://img.shields.io/badge/download-click-blue?style=for-the-badge)](https://github.com/${process.env.GITHUB_REPOSITORY}/raw/${process.env.GITHUB_REF_NAME}/${folderName}/${(filename)})
[![](https://img.shields.io/badge/plist-link-important?style=for-the-badge)](https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/${process.env.GITHUB_REF_NAME}/${(folderName)}/src/info.plist)
`
}

/**
 * 保存workflow源码文件，方便PR对比
 * @param workflowFolderPath
 * @returns {{plistObj: *}}
 */
function buildWorkflow(workflowFolderPath) {
  const workflowSource = workflowFolderPath + '/src';
  const plistObj = plist.parse(fs.readFileSync(`${workflowSource}/info.plist`, 'utf8'));
  const tempFolder = `${workflowFolderPath}/${plistObj.name}`;
  execSync(`cp -r '${workflowSource}' '${tempFolder}'`);
  // 如果是NODEJS的workflow，需要安装依赖
  if (fs.existsSync(`${workflowSource}/package.json`)) {
    execSync(`cd '${tempFolder}' && npm i`);
  }
  execSync(`cd '${tempFolder}' && zip -r '../${plistObj.name}.alfredworkflow' *`);
  execSync(`rm -rf '${tempFolder}' `);
  return {plistObj};
}

function updatePerWorkflowPage() {
  const targetFolder = path.resolve(__dirname, '../../');
  const folders = fs.readdirSync(targetFolder);
  for (const folderName of folders) {
    const workflowFolder = targetFolder + '/' + folderName;
    const stat = fs.lstatSync(workflowFolder);
    if (stat.isFile()) {
      continue;
    }
    if (folderName.match(/^\./)) {
      continue;
    }
    const files = fs.readdirSync(workflowFolder);
    const workflowSourceCode = files.find(f => f.match(/^src$/));
    if (!workflowSourceCode) {
      continue;
    }
    try {
      buildWorkflow(workflowFolder);
      const {plistObj} = parseWorkflowInfo(workflowFolder);
      updateReadme(workflowFolder, folderName, plistObj);
    } catch (e) {
      console.error(e);
    }
  }
}

function main() {
  if (action === 'updatePerWorkflowPage') {
    updatePerWorkflowPage();
  }
  if (action === 'updateHomePage') {
    updateHomePage();
  }
}

main();
