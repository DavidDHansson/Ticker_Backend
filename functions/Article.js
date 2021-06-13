/* eslint-disable max-len */
/* eslint-disable require-jsdoc */

class Article {
    constructor(id, title, link, img, provider, providerText, providerLink, providerImage, displayDate) {
        this.id = id;
        this.title = title;
        this.link = link;
        this.img = img;
        this.provider = provider;
        this.providerText = providerText;
        this.providerLink = providerLink;
        this.providerImage = providerImage;
        this.displayDate = this.formatDate(displayDate);
    }

    formatDate(d) {
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
}

exports.Article = Article;
