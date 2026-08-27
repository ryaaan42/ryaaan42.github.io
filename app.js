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

  if (timeline) timeline.style.transform = `scaleX(${progress})`
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

const siteNav = document.querySelector(".site-nav")

if (siteNav && !document.body.classList.contains("page-inner")) {
  const onScrollNav = () => {
    siteNav.classList.toggle("is-stuck", window.scrollY > 18)
  }

  onScrollNav()
  window.addEventListener("scroll", onScrollNav, { passive: true })
}

document.querySelectorAll(".faq-item").forEach((item) => {
  item.addEventListener("toggle", () => {
    if (!item.open) return
    document.querySelectorAll(".faq-item").forEach((other) => {
      if (other !== item) other.open = false
    })
  })
})
