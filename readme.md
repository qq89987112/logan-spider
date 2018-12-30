#

## note

- 想要调试爬虫,通过 require("logan-spider") 的形式进行
- 如果puppeteer安装失败, 请尝试

    npm config set puppeteer_download_host=https://storage.googleapis.com.cnpmjs.org

- 框架不进行页面错误、过于精确的加载完成的处理，你可以通过
    - 重试：spider里重新进行请求来达到准确的获取。
    - 延迟：通过框架提供的api