// 鼠标视差：让手机跟随鼠标轻微摆动
(function(){
// 鼠标视差：让手机跟随鼠标轻微摆动
  const scene = document.querySelector('.phone-scene');
  const heroRight = document.querySelector('.hero-right');
  if (scene && heroRight && window.matchMedia('(min-width: 1100px)').matches) {
    heroRight.addEventListener('mousemove', (e) => {
      const rect = heroRight.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      scene.style.animation = 'none';
      scene.style.transform = `rotateY(${-18 + x * 14}deg) rotateX(${6 - y * 10}deg) rotateZ(${-2 + x * 3}deg)`;
    });
    heroRight.addEventListener('mouseleave', () => {
      scene.style.animation = '';
      scene.style.transform = '';
    });
  }
})();
