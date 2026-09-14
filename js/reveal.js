// 滚动时的 reveal 动画（进入视口才播放）
(function(){
// 滚动时的 reveal 动画（进入视口才播放）
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.animationPlayState = 'running';
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('.reveal').forEach(el => {
    el.style.animationPlayState = 'paused';
    observer.observe(el);
  });
})();
