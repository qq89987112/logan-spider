const JSDOM = require("jsdom").JSDOM
const request = require("request")
const jQuery = require("jquery")
const async = require("async")
const fs = require("fs")
const path = require("path")
const beautify = require("js-beautify")
const repl = require("repl")
const puppeteer = require("puppeteer")
const ws = require("ws").Server
const opn = require("opn")
const allSpiders = []
const result = {}
let lastContext
let browser
let options = {} 


let initWss = (()=>{
    const wsSet = new Set()
    let wss
    return function () {
        if (!wss) {
            wss = new ws({
                port: 3000 // 可以与web服务器端口一样 
            });
            wss.on("error", (...params) => {
                wss = null
                logger.log(...params)
            });
            wss.on("close", () => {
                wss = null
            });
            wss.on('connection', function connection(ws) {
                wsSet.add(ws)
                ws.on("error", logger.error)
                ws.on('message', data => {
                    const message = JSON.parse(data);
                })
                ws.send(JSON.stringify({ type: 'list', data: result }))
            })
            process.on("exit", ()=> {
                wss && wss.close()
                browser && browser.close()
            })
        }
        return wss
    }
})();



let isInit

async function init () {
    if (isInit) return
    isInit = true
    if (options.javascript && !browser) {
        logger.verbose(`正在启动 puppeteer`)
        browser = await puppeteer.launch({ headless: true, ignoreHTTPSErrors: true })
        logger.verbose(`启动 puppeteer 完成`)
    }
    initWss()
    const replServer = repl.start('> ')
    Object.assign(replServer.context, {
        showTable () {
            opn(`${path.join(__dirname, "./ui/element.html")}`)
        },
        watch () {

        }
    })
}

const logger = {
    verbose (...params) {
        if (options.verbose) {
            logger.log(...params)
        }
    },
    log (...params) {
        if (!options.silent) {
            logger.log(...params)
        }
    },
    error (...params) {
        if (!options.silent) {
            logger.error(...params)
        }
    }
}


function save (context, data) {
    if (data && data.$type) {
        let list = result[data.$type] = result[data.$type] || []
        list.push({ $url: context.url, ...data })
    }
}

const spider = (()=>{
    
    const q = async.queue(({url, name = '', $errorTimes = 1, params = {}}, cb)=>{
        async function temp () {
            logger.log(options.javascript ? 'puppeteer ' : '', `正在爬取 ${JSON.stringify(url)}`)
            isContinue = true
            let dom
            let $
            let body
            let page
            try {
                if (options.javascript) {
                    page = await browser.newPage();
                    await page.setRequestInterception(true)
                    page.on('request', request => {
                        let rurl = request.url()
                        const ui = [".css", ".jpg", ".png"]
                        const domain = ["google"]
                        if (ui.find(i => rurl.endsWith(i)) || domain.find(i => rurl.indexOf(i) > -1)) {
                            logger.verbose(`已经终止 ${rurl} 的请求`)
                            request.abort().catch(()=>{})
                        } else {
                            request.continue().catch(()=>{})
                        }
                    });
                    // await page.goto(url, { timeout: 3000000 }); // 5分钟
                    await page.goto(url);
                    async function get (times = 1) {
                        if (times > 3) {
                            return false
                        }
                        dom = new JSDOM(body = await page.content());
                        $ = jQuery(dom.window);
                        if (!$("body").text()) {
                            logger.error(`获取到的页面：${url} 内容为空, 尝试等待, 第${times}次。三次后结束`)
                            await page.waitFor(1000);
                            return await get(++times)
                        }
                        return true
                    }
                    if (!await get()){
                        throw '页面内容为空'
                    }
                } else {
                    await new Promise((resolve, reject) => {
                        request({url},(error, response, _body)=>{
                            if (error) {
                                reject(error)
                            } else {
                                body = _body
                                dom = new JSDOM(_body);
                                $ = jQuery(dom.window);
                                resolve(_body)
                            } 
                        })
                    })
                }
            } catch (e) {
                logger.error(`${url} 出现错误 ${e.message ? e.message : e},现在尝试重新获取,3次后抛弃请求`, ` —— 第${$errorTimes}次`)
                $errorTimes < 3 && q.push({url, params, $errorTimes: ++$errorTimes})
                page && page.close()
                cb()
                return
            }
    
            logger.verbose(`${url} 下载完成, 内容：${body.slice(0, 50)}`)
            let matchedSpider = allSpiders.filter(i => !name || name === i.spider.name)
            if (name && !matchedSpider.length) {
                logger.error(`无匹配的spider：${name}`)
                page && page.close()
                cb()
                return
            }
            const context = lastContext = { $, body, fetch: spider.fetch.bind(spider), url, params, beautify: { html: beautify.html, css: beautify.css, js: beautify.js } }
            matchedSpider.forEach(i => {
                let loop = i.spider.handler(context)
                let data = loop.next()
                while (data && !data.done) {
                    save(context, data.value)
                    data = loop.next()
                }
            })
            page && page.close()
            cb()
        }

        temp()

    }, 2);

    q.drain = (()=>{
        return () => {
            if (lastContext && indexSpider.spider.completed instanceof Function) {
                indexSpider.spider.completed(lastContext)
                lastContext = null
            }
            setTimeout(() => {
                if (!q.length) {
                    logger.log('恭喜, 全部爬取完毕！')
                }
            }, 1500)
        };
    })()

    q.error = (error) => {
        console.trace(error)
    }

    return {
        // url,name
        async fetch (params) {
            await init()
            q.push(params);
        }
    }
})();


function readDirSync(_path) {
    let indexSpider
    if (fs.existsSync(_path)) {
        const pa = fs.readdirSync(_path)
        pa.forEach(function(ele, index) {
            const addr = path.join(_path, ele);
            if (fs.statSync(addr).isDirectory()) {
                readDirSync(addr);
            } else {
                let spider = require(addr)
                let spiderObj = {
                    path: addr,
                    name: spider.name,
                    spider: spider
                }
                allSpiders.push(spiderObj)
                if (path.basename(addr) === 'index.js') {
                    indexSpider = spiderObj
                }
            }
        })
    }
    return indexSpider
}

module.exports = async function (_options) {
    options = _options
    if (options.folder) {
        // 可以是项目相对路径 or 绝对路径
        options.folder = path.resolve(__dirname, options.folder)
        if (!fs.existsSync(options.folder)) {
            logger.error(`非法地址: ${options.folder}`)
            return
        }
        if (!fs.statSync(options.folder).isDirectory()) {
            logger.error(`您指定的${options.folder}并非为文件夹`)
            return
        }
        indexSpider = readDirSync(options.folder)
        if (indexSpider) {
            const url = indexSpider.spider.url
            if (url) {
                spider.fetch({ url })
            } else {
                const context = { fetch: spider.fetch.bind(spider) }
                let loop = indexSpider.spider.handler(context)
                let data = loop.next()
                while (data && !data.done) {
                    save(context, data.value)
                    data = loop.next()
                }
            }
        } else  {
            logger.error(`文件夹${options.folder}下没有index.js`)
        }

    } else if (options.filename) {
        options.filename = path.resolve(__dirname, options.filename)

        if (!fs.existsSync(options.filename)) {
            logger.error(`非法地址: ${options.filename}`)
            return
        }
        let spider = require(options.filename)
        indexSpider = {
            path: options.filename,
            spider: spider
        }
        allSpiders.push(indexSpider)
        spider.fetch({ url: spider.url, name: spider.spider.name })
    } else {
        logger.error(`请指定 folder 或者 filename`)
    }
}
