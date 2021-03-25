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

        // --------- REDDIT ---------
        // Fetch from endpoint
        const subreddit = "stocks";
        const endpoint = `https://www.reddit.com/r/${subreddit}/top.json`;
        let redditData;
        try {
            redditData = await axios.get(endpoint);
        } catch {
            res.json("reddit error");
            return;
        }

        // Pagination
        const amountOfStickyPost = 0;
        const redditStart = (Math.floor(per * 0.25) * page) + amountOfStickyPost;
        const redditEnd = Math.floor(per * 0.25) + redditStart;
        const redditAmount = redditEnd > redditData?.data.data.children.length ? 0 : Math.floor(per * 0.25);

        // Get and process data
        const redditArticles = redditData?.data.data.children.slice(redditStart, redditEnd).map((post) => {
            return new Article(
                post.data.title, post.data.url,
                null, `r/${subreddit}`, `Upvotes: ${post.data.ups}`,
                `https://www.reddit.com/r/${subreddit}`,
                "https://styles.redditmedia.com/t5_2qjfk/styles/communityIcon_4s2v8euutis11.png?width=256&s=242549c1ad52728c825dfe24af8467626e68f392",
                new Date(post.data.created_utc * 1000),
            );
        }) ?? [];

        // --------- FIREBASE ARTICLES ---------
        const articlesCollection = db.collection("articles");

        // Get content and prepare for page
        const newPer = per - redditAmount;
        const first = articlesCollection.where("provider", "==", "euroinvestor").orderBy("date").limit(1000);
        const allContent = await first.get();
        const push = page == 0 ? 1 : (newPer * page);
        const last = allContent.docs[allContent.docs.length - push];

        // Get snapshot from page
        const snapshot = await articlesCollection.where("provider", "==", "euroinvestor").orderBy("date", "desc").startAt(last.data().date).limit(newPer).get();

        // Process and return
        const articles = [];
        snapshot.forEach((doc) => articles.push(doc.data()));

        // --------- RETURN ---------
        // Combine arrays
        if (redditAmount > 0) {
            const redditOffset = Math.ceil(articles.length / redditArticles.length);
            const allArticles = articles;

            for (let i = 0; i < redditArticles.length; i++) {
                allArticles.splice(redditOffset * (i + 1), 0, redditArticles[i]);
            }

            res.json(allArticles);
        } else {
            const allArticles = [...articles, ...(redditAmount == 0 ? [] : redditArticles)];
            res.json(allArticles);
        }
    });

exports.drscraper = functions
    .region("europe-west1")
    .runWith({timeoutSeconds: 540, memory: "4GB"})
    .https.onRequest(async (req, res) => {
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
        await page.goto("https://www.dr.dk/nyheder/penge");
        await page.waitForSelector(".hydra-site-front-page-content");

        // TODO:
        // Special case for videoes
        // Date
        // ProviderText: eg. "kontant", "penge"

        const items = await page.evaluate(() => {
            const chunks = document.querySelectorAll(".hydra-site-front-page-content")[0].childNodes;
            const data = [];

            chunks.forEach((article) => {
                const sections = article.querySelectorAll("li");

                for (let i = 0; i < sections.length; i++) {
                    const title = sections[i].querySelectorAll("a")[1];
                    const img = sections[i].querySelectorAll("source")[0];

                    if (title == null) {
                        break;
                    }

                    data.push({
                        title: title != null ? title.getAttribute("aria-label") : "",
                        link: title != null ? title.getAttribute("href") : "",
                        img: img && `https://www.dr.dk/${img.getAttribute("srcset").split(" ")[2]}`,
                        provider: "DR - Penge",
                        providerText: "",
                        providerLink: "https://www.dr.dk/nyheder/penge",
                        providerImage: "",
                        displayDate: "",
                    });
                }
            });

            return data;
        });

        // Operation done close browser
        await browser.close();

        functions.logger.log(items);
        res.json(items);
        return;
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
