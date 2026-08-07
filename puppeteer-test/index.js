const http = require('http');

const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
        const puppeteer = require('puppeteer');
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const version = await browser.version();
        await browser.close();
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, chromeVersion: version }));
    } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: err.message }));
    }
}).listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
