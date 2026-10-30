// Появление блоков при прокрутке. Класс js скрывает блоки до показа (style.css), поэтому ставится
// сразу в <head>: без скрипта страница видна целиком. При reduced-motion (на Windows — выключенные
// эффекты анимации) блоки только проявляются: сдвиги отключает style.css.
(function () {
  if (!('IntersectionObserver' in window)) return
  document.documentElement.classList.add('js')

  var BLOCKS = '.section h2, .section-lead, .feature .phone, .feature-text, .duo-item, .tile, .step, .final'

  document.addEventListener('DOMContentLoaded', function () {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return
        entry.target.classList.add('is-in')
        observer.unobserve(entry.target)
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' })
    document.querySelectorAll(BLOCKS).forEach(function (el) { observer.observe(el) })
  })
})()
