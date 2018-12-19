#!/usr/bin/env node

const program = require('commander');
const spider = require('../spider');
program
  .version('0.0.1')
  .option('-F, --folder [folder]', '读取整个文件夹作为,并启动 index.js')
  .option('-f, --filename [filename]', '读取单个文件,并启动')
  .option('-v, --verbose', '打印日志')
  .option('-j, --javascript', '默认使用puppeteer作javascript渲染')
  .parse(process.argv);

spider(program)