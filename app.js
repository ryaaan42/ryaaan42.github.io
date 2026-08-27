const revealElements = document.querySelectorAll(".reveal")

if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return

        entry.target.classList.add("is-visible")
        observer.unobserve(entry.target)
      })
    },
    { rootMargin: "0px 0px -10%", threshold: 0.08 }
  )

  revealElements.forEach((element) => revealObserver.observe(element))
} else {
  revealElements.forEach((element) => element.classList.add("is-visible"))
}

const timeline = document.querySelector(".timeline span")
let progressFrame

function updateProgress() {
  const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight
  const progress = scrollableHeight > 0 ? Math.min(window.scrollY / scrollableHeight, 1) : 0

  timeline.style.transform = `scaleX(${progress})`
  progressFrame = undefined
}

function requestProgressUpdate() {
  if (progressFrame) return
  progressFrame = requestAnimationFrame(updateProgress)
}

if (timeline) {
  updateProgress()
  window.addEventListener("scroll", requestProgressUpdate, { passive: true })
  window.addEventListener("resize", requestProgressUpdate)
}
