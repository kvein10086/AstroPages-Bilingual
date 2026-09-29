export interface UIStrings {
  nav: {
    home: string;
    posts: string;
    tags: string;
    about: string;
    archives: string;
    gallery: string;
    search: string;
  };
  post: {
    publishedAt: string;
    updatedAt: string;
    sharePostIntro: string;
    sharePostOn: string;
    sharePostViaEmail: string;
    tagLabel: string;
    backToTop: string;
    goBack: string;
    editPage: string;
    previousPost: string;
    nextPost: string;
    toc: string;
    copyCode: string;
    codeCopied: string;
    copyFailed: string;
  };
  pagination: {
    prev: string;
    next: string;
    page: string;
  };
  home: {
    socialLinks: string;
    featured: string;
    recentPosts: string;
    allPosts: string;
  };
  footer: {
    copyright: string;
    allRightsReserved: string;
  };
  pages: {
    tagTitle: string;
    tagDesc: string;

    tagsTitle: string;
    tagsDesc: string;

    postsTitle: string;
    postsDesc: string;

    archivesTitle: string;
    archivesDesc: string;

    galleryTitle: string;
    galleryDesc: string;
    galleryEmpty: string;

    searchTitle: string;
    searchDesc: string;
  };
  gallery: {
    albumsNav: string;
    filter: string;
    clear: string;
    camera: string;
    lens: string;
    focal: string;
    unknown: string;
    /** Placeholders: {{photos}}, {{albums}} */
    summaryAll: string;
    /** `summaryAll` when there is exactly one album. Placeholders: {{photos}}, {{albums}} */
    summaryAllOneAlbum: string;
    /** Placeholders: {{shown}}, {{total}} */
    summaryFiltered: string;
    /** Placeholder: {{summary}} (the summary text that follows the notice) */
    filtersReset: string;
    noMatch: string;
    focalUltraWide: string;
    focalWide: string;
    focalStandard: string;
    focalShortTele: string;
    focalTele: string;
    focalSuperTele: string;
  };
  a11y: {
    skipToContent: string;
    openMenu: string;
    closeMenu: string;
    toggleTheme: string;
    searchPlaceholder: string;
    noResults: string;
    goToPreviousPage: string;
    goToNextPage: string;
    lightboxClose: string;
    lightboxZoom: string;
    lightboxPrev: string;
    lightboxNext: string;
    lightboxError: string;
    lightboxVideoError: string;
    playVideo: string;
    openToc: string;
    closeToc: string;
    /** Placeholder: {{heading}} (the heading's text) */
    headingAnchor: string;
    zoomImage: string;
    /** `zoomImage` for an image with alt text. Placeholder: {{alt}} */
    zoomImageAlt: string;
  };
  notFound: {
    title: string;
    message: string;
    goHome: string;
  };
}
