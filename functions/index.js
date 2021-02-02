const functions = require("firebase-functions");
const puppeteer = require('puppeteer');
const chromium = require('chrome-aws-lambda');

exports.newsscraper = functions
    .runWith({ timeoutSeconds: 540, memory: "4GB" })
    .https.onRequest(async (req, res) => {
        
        try {
            let start = new Date().getTime();
            const browser = await puppeteer.launch({
                args: [
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--disable-setuid-sandbox',
                    '--no-first-run',
                    '--no-sandbox',
                    '--no-zygote',
                    '--single-process'

                ],
                defaultViewport: chromium.defaultViewport,
                headless: chromium.headless
            });
            const page = await browser.newPage();
            await page.goto("https://www.euroinvestor.dk/nyheder");
            await page.waitForSelector(".content-wrapper");

            var items = await page.evaluate(() => {
                let data = [];
                let articles = document.getElementsByTagName("article");

                for (let i = 0; i < articles.length; i++) {
                    let title = articles[i].querySelector("div > a:last-child > h2").innerHTML;
                    let link = articles[i].querySelector("div a:last-child").href;
                    let img = articles[i].childNodes.length == 2 ? articles[i].querySelector("a").href : "";

                    data.push({ title: title, link: link, img: img });
                }

                return data;
            });

            await browser.close();
            var end = new Date().getTime();
            items.unshift({time: end - start})
            return res.json(items);

        } catch (err) {
            return res.json({ result: "Error" });
        }
    });