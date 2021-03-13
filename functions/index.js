/* eslint-disable max-len */
/* eslint-disable no-undef */
const functions = require("firebase-functions");

const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

const puppeteer = require("puppeteer");
const chromium = require("chrome-aws-lambda");
const axios = require("axios");
const {Article} = require("./Article");

exports.home = functions
    .region("europe-west1")
    .https.onRequest(async (req, res) => {
        // Parameters
        const per = Number(req.query.per ?? 20);
        const page = Number(req.query.page ?? 0);
        const redditafter = req.query.redditafter ?? "";

        // --------- REDDIT ---------
        // Fetch from endpoint
        const subreddit = "stocks";
        const endpoint = `https://www.reddit.com/r/${subreddit}/hot.json?${redditafter}`;
        let redditData;
        try {
            redditData = await axios.get(endpoint);
        } catch {
            res.json("reddit error");
            return;
        }

        const redditAmount = Math.floor(per * 0.25);
        const redditArticles = redditData?.data.data.children.slice(2, redditAmount + 2).map((post) => {
            return new Article(
                post.data.title, post.data.url,
                null, `r/${subreddit}`, null,
                `https://www.reddit.com/r/${subreddit}`,
                "https://styles.redditmedia.com/t5_2qjfk/styles/communityIcon_4s2v8euutis11.png?width=256&s=242549c1ad52728c825dfe24af8467626e68f392",
                new Date(post.data.created_utc * 1000),
                post.data.name,
            );
        }) ?? [];

        // TODO: Set all reddit articles reddit id to be the very very last id of the call

        res.json(redditArticles);
        // --------- FIREBASE ARTICLES ---------
        const articlesCollection = db.collection("articles");

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

        // --------- RETURN ---------
        // Combine and shuffle array
        const allArticles = [...articles, ...redditArticles];
        let currentIndex = allArticles.length; let temporaryValue; let randomIndex;
        while (0 !== currentIndex) {
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex -= 1;
            temporaryValue = allArticles[currentIndex];
            allArticles[currentIndex] = allArticles[randomIndex];
            allArticles[randomIndex] = temporaryValue;
        }

        res.json(allArticles);
    });

exports.scraper = functions
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

            const d = new Date();
            let month = "" + (d.getMonth() + 1);
            let day = "" + d.getDate();
            const year = d.getFullYear();

            if (month.length < 2) {
                month = "0" + month;
            }
            if (day.length < 2) {
                day = "0" + day;
            }

            const finalDate = [day, month, year].join("/");

            articles.forEach((article) => {
                const title = article.querySelector("div > a:last-child > h2").innerHTML;
                const link = article.querySelector("div a:last-child").href;
                const img = article.childNodes.length == 2 ? article.querySelector("figure").getAttribute("data-original") : "";

                data.push({title: title, link: link, img: img,
                    provider: "euroinvestor",
                    providerText: "NYHEDER",
                    providerLink: "https://www.euroinvestor.dk",
                    providerImage: "https://4hansson.dk/test/ticker/euroinvestorlogo.png",
                    displayDate: finalDate,
                });
            });

            return data.reverse();
        });

        // Operation done close browser
        await browser.close();

        // Get 50 latest articles from Firestore
        const articlesCollection = db.collection("articles");
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
            await db.collection("articles").add({...final[i], ...{date: admin.firestore.Timestamp.now()}});
        }

        res.json({result: "success", time: ms, placed: final});
    });
