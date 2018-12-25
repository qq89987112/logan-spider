const path = require('path')
const opn = require("opn")

module.exports = {
    showTable () {
        opn(`${path.join(__dirname, "./element.html")}`)
    },
    showChart () {
        opn(`${path.join(__dirname, "./echart.html")}`)
    },
}