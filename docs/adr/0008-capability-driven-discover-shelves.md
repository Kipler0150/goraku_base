# Capability-driven Discover shelves

Status: accepted

The Discover Workspace uses independent Popular now, Trending this week, and Latest Releases shelves with one explicit source per selected Media type. Shelves scroll horizontally only within Discover, while other surfaces remain vertical; Popular and Trending use existing Provider capabilities, and Latest Releases is a new explicit capability implemented only where a Provider can provide a genuine release-oriented list. Unsupported shelves remain visible with an honest state instead of being replaced or mislabeled, and shelf failures do not block successful shelves.

This preserves Provider ownership and ranking semantics while giving Discover the Netflix-style stacked browsing rhythm without introducing personalized ranking or a mixed-Provider global order.
