#!/usr/bin/env node
const ui = require('../ui')
const program = require('commander');
const spider = require('../spider');

program
  .version('0.0.1')

program
  .command('spider')
  .description('爬虫')
  .option('-F, --folder [folder]', '读取整个文件夹作为,并启动 index.js')
  .option('-f, --filename [filename]', '读取单个文件,并启动')
  .option('-v, --verbose', '打印日志')
  .option('-j, --javascript', '默认使用puppeteer作javascript渲染')
  .action(spider)

program
  .command('ui')
  .description('显示相关图表')
  .option('-t, --table', '显示表格视图')
  .option('-c, --chart', '显示图表视图')
  .action(function (cmd) {
    if (cmd.chart) {
      ui.showChart()
    }
    if (cmd.table) {
      ui.showTable()
    }
  })

program.parse(process.argv)