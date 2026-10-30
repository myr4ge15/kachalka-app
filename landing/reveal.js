// Появление блоков при прокрутке и счет цифр. Класс js скрывает блоки до показа (style.css),
// поэтому ставится сразу в <head>: без скрипта страница видна целиком. При reduced-motion
// (на Windows — выключенные эффекты анимации) блоки только проявляются, цифры не считаются.
(function () {
  var root = document.documentElement
  if (!('IntersectionObserver' in window)) return
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  root.classList.add('js')

  var BLOCKS = '.facts p, .section h2, .section-lead, .feature .phone, .feature-text, .duo-item, .tile, .step, .final'
  var COUNT_MS = 900

  function count(el) {
    var target = Number(el.dataset.count)
    var start = performance.now()
    function tick(now) {
      var t = Math.min((now - start) / COUNT_MS, 1)
      el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)))
      if (t < 1) requestAnimationFrame(tick)
    }
    el.textContent = '0'
    requestAnimationFrame(tick)
  }

  document.addEventListener('DOMContentLoaded', function () {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return
        entry.target.classList.add('is-in')
        observer.unobserve(entry.target)
        var number = entry.target.querySelector('[data-count]')
        if (number && !reduced) count(number)
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' })
    document.querySelectorAll(BLOCKS).forEach(function (el) { observer.observe(el) })
  })
})()
