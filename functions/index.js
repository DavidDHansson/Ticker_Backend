/* eslint-disable max-len */
/* eslint-disable no-undef */
const functions = require("firebase-functions");

const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

const puppeteer = require("puppeteer");
const chromium = require("chrome-aws-lambda");

exports.home = functions
    .region("europe-west1")
    .https.onRequest(async (req, res) => {
        const per = Number(req.query.per ?? 20);
        const page = Number(req.query.page ?? 1);

        const articlesCollection = db.collection("euroinvestorarticles");

        // Get content and prepare for page
        const first = articlesCollection.where("provider", "==", "euroinvestor").orderBy("date").limit(1000);
        const allContent = await first.get();
        const push = page == 0 ? 1 : (per * page);
        const last = allContent.docs[allContent.docs.length - push];

        // Get snapshot from page
        const snapshot = await articlesCollection.where("provider", "==", "euroinvestor").orderBy("date", "desc").startAt(last.data().date).limit(per).get();

        // Process and return
        const articles = [];
        snapshot.forEach((doc) => articles.push(doc.data()));
        res.json(articles);
    });

exports.euroinvestorscraper = functions
    .region("europe-west1")
    .runWith({timeoutSeconds: 540, memory: "4GB"})
    .https.onRequest(async (req, res) => {
        const start = new Date().getTime();
        const browser = await puppeteer.launch({
            args: [
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--disable-setuid-sandbox",
                "--no-first-run",
                "--no-sandbox",
                "--no-zygote",
                "--single-process",
            ],
            defaultViewport: chromium.defaultViewport,
            headless: chromium.headless,
        });
        const page = await browser.newPage();
        await page.goto("https://www.euroinvestor.dk/nyheder");
        await page.waitForSelector(".content-wrapper");

        const items = await page.evaluate(() => {
            const data = []; const articles = document.getElementsByTagName("article");

            articles.forEach((article) => {
                const title = article.querySelector("div > a:last-child > h2").innerHTML;
                const link = article.querySelector("div a:last-child").href;
                const img = article.childNodes.length == 2 ? article.querySelector("figure").getAttribute("data-original") : "";

                data.push({title: title, link: link, img: img,
                    provider: "euroinvestor",
                    providerText: "euroinvestor",
                    providerLink: "https://www.euroinvestor.dk",
                    providerImage: "http://4hansson.dk/test/ticker/euroinvestorlogo.png",
                    displayDate: formatDate(new Date()),
                });
            });

            return data;
        });

        // Operation done close browser
        await browser.close();

        // Get 50 latest articles from Firestore
        const articlesCollection = db.collection("euroinvestorarticles");
        const snapshot = await articlesCollection.where("provider", "==", "euroinvestor").orderBy("date", "desc").limit(40).get();
        const articles = [];
        snapshot.forEach((doc) => articles.push(doc.data()));

        // Remove duplicates
        const final = items.filter((item) => !articles.find((article) => item.title === article.title));

        // Add ms time
        const ms = (new Date().getTime()) - start;
        final.map((item) => item.time = ms);

        // Add to Firebase Firestore collection
        for (let i = 0; i < final.length; i++) {
            await db.collection("euroinvestorarticles").add({...final[i], ...{date: admin.firestore.Timestamp.now()}});
        }

        res.json({result: "success", time: ms, placed: final});
    });

/**
 * Formats a date
 * @param {date} date the date
 * @return {string} returns date
 */
function formatDate(date) {
    const d = new Date(date);
    let month = "" + (d.getMonth() + 1);
    let day = "" + d.getDate();
    const year = d.getFullYear();

    if (month.length < 2) {
        month = "0" + month;
    }
    if (day.length < 2) {
        day = "0" + day;
    }

    return [day, month, year].join("/");
}
