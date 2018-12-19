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
let browser
let options = {} 

const wsSet = new Set()
const wss = new ws({
    port: 3000 // 可以与web服务器端口一样 
});

wss.on("error", console.error);
wss.on('connection', function connection(ws) {
    wsSet.add(ws)
    ws.on("error", console.error)
    ws.on('message', data => {
        const message = JSON.parse(data);
    })
    ws.send(JSON.stringify({ type: 'list', data: result }))
})

process.on("exit", ()=> wss.close())

function verbose (...params) {
    if (options.verbose) {
        console.log(...params)
    }
}

function save (context, data) {
    if (data && data.$type) {
        let list = result[data.$type] = result[data.$type] || []
        list.push({ $url: context.url, ...data })
    }
}

const spider = (()=>{
    
    const q = async.queue(({url, name, extParams, $errorTimes = 1}, cb)=>{
        async function temp () {

            verbose(options.javascript ? 'puppeteer ' : '', `正在爬取 ${JSON.stringify(url)}`)
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
                            verbose(`已经终止 ${rurl} 的请求`)
                            request.abort().catch(()=>{})
                        } else {
                            request.continue().catch(()=>{})
                        }
                    });
                    // await page.goto(url, { timeout: 3000000 }); // 5分钟
                    await page.goto(url);
                    dom = new JSDOM(body = await page.content());
                    $ = jQuery(dom.window);
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
                console.error(`${url} 出现错误 ${e.message ? e.message : e},现在尝试重新获取,3次后抛弃请求`, ` —— 第${$errorTimes}次`)
                $errorTimes < 3 && q.push({url, extParams, $errorTimes: ++$errorTimes})
                cb()
                return
            }
    
            verbose(`${url} 下载完成, 内容：${body.slice(0, 50)}`)
            let matchedSpider = allSpiders.filter(i => !name || name === i.spider.name)
            if (name && !matchedSpider.length) {
                console.error(`无匹配的spider：${name}`)
                page && page.close()
                cb()
                return
            }
            const context = { $, dom, fetch: spider.fetch.bind(spider), url, params: extParams, beautify: { html: beautify.html, css: beautify.css, js: beautify.js } }
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

    q.drain = () => {
        console.log('恭喜, 全部爬取完毕！')
        const replServer = repl.start('> ')
        Object.assign(replServer.context, {
            result,
            inject: `javascript:(function () { var script = document.createElement('script'); script.src="//cdn.bootcss.com/jquery/3.3.1/jquery.min.js"; document.body.appendChild(script);  })()`,
            showTable () {
                opn(`${path.join(__dirname, "./ui/element.html")}`)
            },
            watch () {

            }
        })
        replServer.on('exit', ()=> browser && browser.close())
    };

    q.error = (error) => {
        console.trace(error)
    }

    return {
        async fetch ({url, name = 'index', extParams = {}}) {
            if (options.javascript && !browser) {
                verbose(`正在启动 puppeteer`)
                browser = await puppeteer.launch({ ignoreHTTPSErrors: true })
                verbose(`启动 puppeteer 完成`)
            }
            q.push({url, name, extParams});
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
            console.error(`非法地址: ${options.folder}`)
            return
        }
        if (!fs.statSync(options.folder).isDirectory()) {
            console.error(`您指定的${options.folder}并非为文件夹`)
            return
        }
        let indexSpider = readDirSync(options.folder)
        if (indexSpider) {
            spider.fetch({ url: indexSpider.spider.url })
        } else  {
            console.error(`文件夹${options.folder}下没有index.js`)
        }

    } else if (options.filename) {
        options.filename = path.resolve(__dirname, options.filename)

        if (!fs.existsSync(options.filename)) {
            console.error(`非法地址: ${options.filename}`)
            return
        }
        let spider = require(options.filename)
        allSpiders.push({
            path: options.filename,
            name: spider.name,
            spider: spider
        })
        spider.fetch({ url: spider.url, name: spider.spider.name })
    } else {
        console.error(`请指定 folder 或者 filename`)
    }
}
