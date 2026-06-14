// ─── Shared one-click PDF download (invoices + confirmations) ────────────────
// Each document is a self-contained HTML string with its own <style>. We render
// it in an offscreen iframe so that CSS applies exactly as in the preview, then
// rasterise it to a single A4 PDF via html2pdf. If the library can't load (e.g.
// offline / CDN blocked) we fall back to the browser's native print-to-PDF.
(function () {
  const LIB = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.3/html2pdf.bundle.min.js';

  function loadLib() {
    return new Promise((resolve, reject) => {
      if (window.html2pdf) return resolve(window.html2pdf);
      const s = document.createElement('script');
      s.src = LIB;
      s.onload = () => resolve(window.html2pdf);
      s.onerror = () => reject(new Error('html2pdf failed to load'));
      document.head.appendChild(s);
    });
  }

  // Native fallback: open the document and trigger Print → "Save as PDF".
  function printFallback(html) {
    const w = window.open('', '_blank');
    if (!w) {
      alert('Allow pop-ups to download the PDF, or open the link and use your browser’s Print → Save as PDF.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.onload = () => { try { w.focus(); w.print(); } catch (e) {} };
  }

  async function download(html, filename) {
    const pdfName = String(filename || 'document').replace(/\.html?$/i, '') + '.pdf';

    let html2pdf;
    try { html2pdf = await loadLib(); }
    catch { return printFallback(html); }

    // Offscreen iframe — the document's own <style> applies inside it.
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:1400px;border:0;visibility:hidden';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open(); doc.write(html); doc.close();

    // Wait for load, web fonts, then a short beat for images to settle.
    await new Promise((r) => { if (doc.readyState === 'complete') r(); else iframe.onload = r; });
    try { if (doc.fonts && doc.fonts.ready) await doc.fonts.ready; } catch (e) {}
    await new Promise((r) => setTimeout(r, 400));

    const target = doc.querySelector('.sheet') || doc.body;

    try {
      await html2pdf().set({
        margin: 0,
        filename: pdfName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 900 },
        jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      }).from(target).save();
    } catch (e) {
      printFallback(html);
    } finally {
      setTimeout(() => iframe.remove(), 1500);
    }
  }

  window.IziPDF = { download };
})();
