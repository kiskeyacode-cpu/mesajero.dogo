import { esc } from './util.js';
import { EMPRESAS } from './config.js';

// Patrones oficiales Code 128 (índice 0-106)
const PATRONES = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212',
  '112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131',
  '311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321',
  '112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121',
  '313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114',
  '122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212',
  '124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113',
  '114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'
];

// Texto -> secuencia de barras Code 128 B
function codificar128(texto) {
  const valores = [];
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c < 32 || c > 126) throw new Error('Solo se permiten caracteres ASCII imprimibles.');
    valores.push(c - 32);
  }
  let suma = 104;
  valores.forEach((v, i) => { suma += v * (i + 1); });
  const secuencia = [104, ...valores, suma % 103, 106];
  return secuencia.map(v => PATRONES[v]).join('');
}

function crearSVG(valor, anchoBarra, altoMm) {
  const patron = codificar128(valor);
  const alto = altoMm * 3.78;
  const margen = 10 * anchoBarra;
  let x = margen, negro = true, barras = '';
  for (const d of patron) {
    const w = Number(d) * anchoBarra;
    if (negro) barras += `<rect x="${x}" y="0" width="${w}" height="${alto}" fill="#000"/>`;
    x += w;
    negro = !negro;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + margen} ${alto + 5}" role="img" aria-label="Código de barras ${esc(valor)}">${barras}</svg>`;
}

export function iniciarBarras(emp, cont) {
  if (cont.dataset.listo) return;
  cont.dataset.listo = '1';
  const E = EMPRESAS[emp];

  cont.innerHTML = `
    <div class="panel">
      <h2>Lista de números de seguimiento</h2>
      <textarea id="bcCodigos" placeholder="Pega tus códigos aquí, uno por línea:&#10;&#10;${emp === 'jt' ? 'JDM000000000001' : '6102426991602'}"></textarea>
      <div class="row" style="margin:12px 0">
        <label class="small">Altura de barras (mm) <input id="bcAlto" type="number" value="22" min="10" max="80" style="width:90px"></label>
        <label class="small">Ancho de barras (px) <input id="bcAncho" type="number" value="2" min="1" max="5" style="width:90px"></label>
      </div>
      <div class="row">
        <button class="primary" id="bcGenerar">Generar códigos</button>
        <button class="outline" id="bcImprimir">Imprimir todos</button>
        <button class="outline" id="bcCsv">Exportar lista</button>
        <button class="danger" id="bcLimpiar">Limpiar</button>
      </div>
      <div class="small" id="bcStats" style="margin-top:12px">0 códigos generados</div>
      <div class="small err-t" id="bcError"></div>
    </div>
    <div class="bc-grid" id="bcResultados"></div>`;

  const $ = id => cont.querySelector('#' + id);
  const resultados = $('bcResultados');

  $('bcGenerar').onclick = () => {
    const codigos = [...new Set($('bcCodigos').value.split(/[\n,;\t]+/).map(x => x.trim()).filter(Boolean))];
    const ancho = Number($('bcAncho').value) || 2;
    const alto = Number($('bcAlto').value) || 22;
    resultados.innerHTML = '';
    $('bcError').textContent = '';

    const invalidos = [], otroFormato = [];
    let hechos = 0;
    codigos.forEach(c => {
      try {
        const svg = crearSVG(c, ancho, alto);
        const el = document.createElement('div');
        el.className = 'bc-label';
        el.innerHTML = `${svg}<div class="tracking">${esc(c)}</div>`;
        resultados.appendChild(el);
        hechos++;
        if (!E.valido(c)) otroFormato.push(c);
      } catch { invalidos.push(c); }
    });

    $('bcStats').textContent = `${hechos} códigos generados`;
    const avisos = [];
    if (invalidos.length) avisos.push('Códigos inválidos: ' + invalidos.join(', '));
    if (otroFormato.length) avisos.push(`${otroFormato.length} código(s) no tienen el formato de ${E.nombre} (${E.formato}); se generaron igual: ${otroFormato.slice(0, 5).join(', ')}${otroFormato.length > 5 ? '…' : ''}`);
    $('bcError').textContent = avisos.join(' · ');
  };

  $('bcImprimir').onclick = () => {
    if (!resultados.children.length) return alert('Primero genera los códigos.');
    window.print();
  };

  $('bcCsv').onclick = () => {
    const codigos = [...resultados.querySelectorAll('.tracking')].map(e => e.textContent);
    if (!codigos.length) return alert('Primero genera los códigos.');
    const url = URL.createObjectURL(new Blob(['\uFEFFCodigo\n' + codigos.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'codigos_seguimiento.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  $('bcLimpiar').onclick = () => {
    $('bcCodigos').value = '';
    resultados.innerHTML = '';
    $('bcStats').textContent = '0 códigos generados';
    $('bcError').textContent = '';
  };
}
