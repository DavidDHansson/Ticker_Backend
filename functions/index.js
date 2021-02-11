const functions = require("firebase-functions");

const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const puppeteer = require('puppeteer');
const chromium = require('chrome-aws-lambda');

exports.newsscraper = functions
    .region("europe-west1")
    .runWith({ timeoutSeconds: 540, memory: "4GB" })
    .https.onRequest(async (req, res) => {

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
            let data = []; let articles = document.getElementsByTagName("article");

            articles.forEach(article => {
                let title = article.querySelector("div > a:last-child > h2").innerHTML;
                let link = article.querySelector("div a:last-child").href;
                let img = article.childNodes.length == 2 ? article.querySelector("figure").getAttribute("data-original") : "";

                data.push({ title: title, link: link, img: img, provider: "euroinvestor" });
            });

            return data;
        });

        // Operation done close browser
        await browser.close();

        // Get 50 latest articles from Firestore
        const articlesCollection = db.collection("articles");
        const snapshot = await articlesCollection.where("provider", "==", "euroinvestor").orderBy("date").limit(50).get();
        let articles = [];
        snapshot.forEach(doc => articles.push(doc.data()));

        // Remove duplicates
        let final = items.filter(item => !articles.find(article => item.title === article.title));

        // Add ms time
        var ms = (new Date().getTime()) - start;
        final.map(item => item.time = ms);

        // Add to Firebase Firestore collection
        for (let i = 0; i < final.length; i++) {
            await db.collection("articles").add({ ...final[i], ...{ date: admin.firestore.Timestamp.now() } });
        }

        return res.json({ result: "Success" });
    });