import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  Link,
  useParams,
} from "react-router-dom"

import { api } from "../api/client"

// ======================================================
// HELPERS
// ======================================================

function cleanText(value) {
  return String(
    value ?? ""
  ).trim()
}

function unique(values) {
  return [
    ...new Set(
      values
        .map(cleanText)
        .filter(Boolean)
    ),
  ]
}

function getAttributes(
  variant
) {
  return {
    model:
      cleanText(
        variant
          ?.attributes
          ?.model
      ),

    color:
      cleanText(
        variant
          ?.attributes
          ?.color
      ),

    size:
      cleanText(
        variant
          ?.attributes
          ?.size
      ),
  }
}

function variantAvailable(
  variant
) {
  return (
    variant?.active !==
      false &&
    Number(
      variant?.stockQty ||
        0
    ) > 0
  )
}

// ======================================================
// PRODUCT PAGE
// ======================================================

function ProductPage({
  addToCart,
}) {
  const { id } =
    useParams()

  const [
    product,
    setProduct,
  ] = useState(null)

  const [
    status,
    setStatus,
  ] = useState(
    "loading"
  )

  const [
    selectedModel,
    setSelectedModel,
  ] = useState("")

  const [
    selectedColor,
    setSelectedColor,
  ] = useState("")

  const [
    selectedSize,
    setSelectedSize,
  ] = useState("")

  const [
    activeImageIndex,
    setActiveImageIndex,
  ] = useState(0)

  const [
    selectionError,
    setSelectionError,
  ] = useState("")

  const touchStartX =
    useRef(null)

  // ====================================================
  // LOAD PRODUCT
  // ====================================================

  useEffect(() => {
    setStatus(
      "loading"
    )

    api
      .get(
        `/catalog/products/${id}`
      )
      .then(
        (data) => {
          setProduct(
            data
          )

          setStatus(
            "ready"
          )

          setSelectedModel(
            ""
          )

          setSelectedColor(
            ""
          )

          setSelectedSize(
            ""
          )

          setActiveImageIndex(
            0
          )
        }
      )
      .catch(() =>
        setStatus(
          "missing"
        )
      )
  }, [id])

  // ====================================================
  // VARIANTS
  // ====================================================

  const variants =
    useMemo(
      () =>
        Array.isArray(
          product?.variants
        )
          ? product.variants
          : [],
      [product]
    )

  const activeVariants =
    useMemo(
      () =>
        variants.filter(
          (variant) =>
            variant?.active !==
            false
        ),
      [variants]
    )

  const models =
    useMemo(
      () =>
        unique(
          activeVariants.map(
            (variant) =>
              getAttributes(
                variant
              ).model
          )
        ),
      [activeVariants]
    )

  const colors =
    useMemo(() => {
      let list =
        activeVariants

      if (
        selectedModel
      ) {
        list =
          list.filter(
            (variant) =>
              getAttributes(
                variant
              ).model ===
              selectedModel
          )
      }

      return unique(
        list.map(
          (variant) =>
            getAttributes(
              variant
            ).color
        )
      )
    }, [
      activeVariants,
      selectedModel,
    ])

  const variantSizes =
    useMemo(() => {
      let list =
        activeVariants

      if (
        selectedModel
      ) {
        list =
          list.filter(
            (variant) =>
              getAttributes(
                variant
              ).model ===
              selectedModel
          )
      }

      if (
        selectedColor
      ) {
        list =
          list.filter(
            (variant) =>
              getAttributes(
                variant
              ).color ===
              selectedColor
          )
      }

      return unique(
        list.map(
          (variant) =>
            getAttributes(
              variant
            ).size
        )
      )
    }, [
      activeVariants,
      selectedModel,
      selectedColor,
    ])

  const simpleSizes =
    useMemo(
      () =>
        Array.isArray(
          product?.sizes
        )
          ? unique(
              product.sizes
            )
          : [],
      [product]
    )

  const usesVariants =
    product
      ?.inventoryMode ===
      "variants" ||
    variants.length > 0

  const hasModelChoice =
    models.length > 0

  const hasColorChoice =
    unique(
      activeVariants.map(
        (variant) =>
          getAttributes(
            variant
          ).color
      )
    ).length > 0

  const hasVariantSizeChoice =
    unique(
      activeVariants.map(
        (variant) =>
          getAttributes(
            variant
          ).size
      )
    ).length > 0

  // ====================================================
  // SELECTED VARIANT
  // ====================================================

  const selectedVariant =
    useMemo(() => {
      if (
        !usesVariants
      ) {
        return null
      }

      return (
        activeVariants.find(
          (variant) => {
            const attrs =
              getAttributes(
                variant
              )

            if (
              hasModelChoice &&
              attrs.model !==
                selectedModel
            ) {
              return false
            }

            if (
              hasColorChoice &&
              attrs.color !==
                selectedColor
            ) {
              return false
            }

            if (
              hasVariantSizeChoice &&
              attrs.size !==
                selectedSize
            ) {
              return false
            }

            return true
          }
        ) || null
      )
    }, [
      usesVariants,
      activeVariants,
      hasModelChoice,
      hasColorChoice,
      hasVariantSizeChoice,
      selectedModel,
      selectedColor,
      selectedSize,
    ])

  // ====================================================
  // GALLERY
  // ====================================================

  const gallery =
    useMemo(() => {
      if (!product) {
        return []
      }

      const result = []

      const pushImage = (
        url,
        source = "product"
      ) => {
        const cleanUrl =
          cleanText(url)

        if (!cleanUrl) {
          return
        }

        if (
          result.some(
            (item) =>
              item.url ===
              cleanUrl
          )
        ) {
          return
        }

        result.push({
          url:
            cleanUrl,

          source,
        })
      }

      const productImages =
        Array.isArray(
          product.images
        )
          ? [
              ...product.images,
            ].sort(
              (a, b) =>
                Number(
                  a.sortOrder ||
                    0
                ) -
                Number(
                  b.sortOrder ||
                    0
                )
            )
          : []

      const primary =
        productImages.find(
          (image) =>
            image.primary
        )

      if (primary) {
        pushImage(
          primary.url,
          "product"
        )
      }

      productImages.forEach(
        (image) =>
          pushImage(
            image.url,
            "product"
          )
      )

      pushImage(
        product.imageUrl,
        "product"
      )

      variants.forEach(
        (variant) => {
          pushImage(
            variant.modelImageUrl,
            "model"
          )

          pushImage(
            variant.colorImageUrl,
            "color"
          )

          pushImage(
            variant.imageUrl,
            "variant"
          )
        }
      )

      return result
    }, [
      product,
      variants,
    ])

  const selectImageByUrl = (
    url
  ) => {
    const cleanUrl =
      cleanText(url)

    if (!cleanUrl) {
      return
    }

    const index =
      gallery.findIndex(
        (image) =>
          image.url ===
          cleanUrl
      )

    if (
      index >=
      0
    ) {
      setActiveImageIndex(
        index
      )
    }
  }

  const previousImage =
    () => {
      if (
        gallery.length <=
        1
      ) {
        return
      }

      setActiveImageIndex(
        (current) =>
          current === 0
            ? gallery.length -
              1
            : current - 1
      )
    }

  const nextImage =
    () => {
      if (
        gallery.length <=
        1
      ) {
        return
      }

      setActiveImageIndex(
        (current) =>
          current ===
          gallery.length - 1
            ? 0
            : current + 1
      )
    }

  // ====================================================
  // SELECTION HANDLERS
  // ====================================================

  const chooseModel = (
    model
  ) => {
    setSelectedModel(
      model
    )

    setSelectedColor(
      ""
    )

    setSelectedSize(
      ""
    )

    setSelectionError(
      ""
    )

    const variant =
      activeVariants.find(
        (item) =>
          getAttributes(
            item
          ).model ===
          model
      )

    selectImageByUrl(
      variant
        ?.modelImageUrl ||
        variant
          ?.imageUrl
    )
  }

  const chooseColor = (
    color
  ) => {
    setSelectedColor(
      color
    )

    setSelectedSize(
      ""
    )

    setSelectionError(
      ""
    )

    const variant =
      activeVariants.find(
        (item) => {
          const attrs =
            getAttributes(
              item
            )

          return (
            (
              !selectedModel ||
              attrs.model ===
                selectedModel
            ) &&
            attrs.color ===
              color
          )
        }
      )

    selectImageByUrl(
      variant
        ?.colorImageUrl ||
        variant
          ?.imageUrl ||
        variant
          ?.modelImageUrl
    )
  }

  const chooseSize = (
    size
  ) => {
    setSelectedSize(
      size
    )

    setSelectionError(
      ""
    )

    if (
      usesVariants
    ) {
      const variant =
        activeVariants.find(
          (item) => {
            const attrs =
              getAttributes(
                item
              )

            return (
              (
                !hasModelChoice ||
                attrs.model ===
                  selectedModel
              ) &&
              (
                !hasColorChoice ||
                attrs.color ===
                  selectedColor
              ) &&
              attrs.size ===
                size
            )
          }
        )

      selectImageByUrl(
        variant?.imageUrl ||
        variant
          ?.colorImageUrl ||
        variant
          ?.modelImageUrl
      )
    }
  }

  // ====================================================
  // AVAILABLE OPTIONS
  // ====================================================

  const modelAvailable = (
    model
  ) =>
    activeVariants.some(
      (variant) =>
        getAttributes(
          variant
        ).model ===
          model &&
        variantAvailable(
          variant
        )
    )

  const colorAvailable = (
    color
  ) =>
    activeVariants.some(
      (variant) => {
        const attrs =
          getAttributes(
            variant
          )

        return (
          (
            !selectedModel ||
            attrs.model ===
              selectedModel
          ) &&
          attrs.color ===
            color &&
          variantAvailable(
            variant
          )
        )
      }
    )

  const sizeAvailable = (
    size
  ) => {
    if (
      !usesVariants
    ) {
      return (
        product?.inStock !==
        false
      )
    }

    return activeVariants.some(
      (variant) => {
        const attrs =
          getAttributes(
            variant
          )

        return (
          (
            !hasModelChoice ||
            attrs.model ===
              selectedModel
          ) &&
          (
            !hasColorChoice ||
            attrs.color ===
              selectedColor
          ) &&
          attrs.size ===
            size &&
          variantAvailable(
            variant
          )
        )
      }
    )
  }

  // ====================================================
  // VALIDATE SELECTION
  // ====================================================

  const missingSelection =
    () => {
      if (
        usesVariants
      ) {
        if (
          hasModelChoice &&
          !selectedModel
        ) {
          return "יש לבחור דגם."
        }

        if (
          hasColorChoice &&
          !selectedColor
        ) {
          return "יש לבחור צבע."
        }

        if (
          hasVariantSizeChoice &&
          !selectedSize
        ) {
          return "יש לבחור מידה."
        }

        if (
          !selectedVariant
        ) {
          return "השילוב שבחרת אינו זמין."
        }

        if (
          !variantAvailable(
            selectedVariant
          )
        ) {
          return "הווריאציה שבחרת אזלה מהמלאי."
        }

        return ""
      }

      if (
        product?.hasSizes &&
        simpleSizes.length >
          0 &&
        !selectedSize
      ) {
        return "יש לבחור מידה."
      }

      return ""
    }

  // ====================================================
  // ADD TO CART
  // ====================================================

  const handleAddToCart =
    () => {
      const error =
        missingSelection()

      if (error) {
        setSelectionError(
          error
        )

        return
      }

      const selection = {
        model:
          selectedVariant
            ? getAttributes(
                selectedVariant
              ).model
            : "",

        color:
          selectedVariant
            ? getAttributes(
                selectedVariant
              ).color
            : "",

        size:
          selectedVariant
            ? getAttributes(
                selectedVariant
              ).size
            : selectedSize,
      }

      const selectedImage =
        selectedVariant
          ?.imageUrl ||
        selectedVariant
          ?.colorImageUrl ||
        selectedVariant
          ?.modelImageUrl ||
        gallery[
          activeImageIndex
        ]?.url ||
        product.imageUrl ||
        ""

      addToCart({
        ...product,

        variantId:
          selectedVariant?.id ||
          null,

        selectedVariant:
          selectedVariant ||
          null,

        selection,

        selectedModel:
          selection.model,

        selectedColor:
          selection.color,

        selectedSize:
          selection.size,

        imageUrl:
          selectedImage,

        cartKey:
          selectedVariant
            ? `${product.id}:${selectedVariant.id}`
            : product.hasSizes &&
              selectedSize
            ? `${product.id}:size:${selectedSize}`
            : `${product.id}:simple`,

        maxStock:
          selectedVariant
            ? Number(
                selectedVariant.stockQty ||
                  0
              )
            : Number(
                product.stockQty ||
                  0
              ),
      })

      setSelectionError(
        ""
      )
    }

  // ====================================================
  // TOUCH / SWIPE
  // ====================================================

  const handleTouchStart =
    (event) => {
      touchStartX.current =
        event.touches?.[0]
          ?.clientX ??
        null
    }

  const handleTouchEnd =
    (event) => {
      if (
        touchStartX.current ===
        null
      ) {
        return
      }

      const endX =
        event.changedTouches
          ?.[0]
          ?.clientX

      if (
        endX ===
        undefined
      ) {
        return
      }

      const difference =
        touchStartX.current -
        endX

      touchStartX.current =
        null

      if (
        Math.abs(
          difference
        ) < 50
      ) {
        return
      }

      if (
        difference > 0
      ) {
        nextImage()
      } else {
        previousImage()
      }
    }

  // ====================================================
  // LOADING / MISSING
  // ====================================================

  if (
    status ===
    "loading"
  ) {
    return (
      <main className="simple-page">
        <h1>
          טוען...
        </h1>
      </main>
    )
  }

  if (
    status ===
      "missing" ||
    !product
  ) {
    return (
      <main className="simple-page">
        <h1>
          המוצר לא נמצא
        </h1>

        <Link
          className="button button-dark"
          to="/"
        >
          חזרה לקניות
        </Link>
      </main>
    )
  }

  const fee =
    Math.round(
      Number(
        product.price ||
          0
      ) *
        0.2
    )

  const currentImage =
    gallery[
      activeImageIndex
    ]?.url ||
    product.imageUrl ||
    ""

  const selectedStock =
    selectedVariant
      ? Number(
          selectedVariant.stockQty ||
            0
        )
      : Number(
          product.stockQty ||
            0
        )

  // ====================================================
  // UI
  // ====================================================

  return (
    <main className="product-page">
      <div className="breadcrumbs">
        <Link to="/">
          הקניון
        </Link>

        <span>
          /
        </span>

        <Link
          to={`/shop/${product.storeSlug}`}
        >
          {product.store}
        </Link>

        <span>
          /
        </span>

        <span>
          {product.name}
        </span>
      </div>

      <div className="product-detail-layout">

        {/* ===============================================
            GALLERY
        =============================================== */}

        <div>
          <div
            className="product-hero-image"
            onTouchStart={
              handleTouchStart
            }
            onTouchEnd={
              handleTouchEnd
            }
            style={{
              position:
                "relative",

              overflow:
                "hidden",
            }}
          >
            {product.badge && (
              <span>
                {product.badge}
              </span>
            )}

            {currentImage ? (
              <img
                src={
                  currentImage
                }
                alt={
                  product.name
                }
                style={{
                  width:
                    "100%",

                  height:
                    "100%",

                  objectFit:
                    "contain",
                }}
              />
            ) : (
              <div className="product-shape">
                תמונה חסרה
              </div>
            )}

            {gallery.length >
              1 && (
              <>
                <button
                  type="button"
                  aria-label="תמונה קודמת"
                  onClick={
                    previousImage
                  }
                  style={{
                    position:
                      "absolute",

                    top:
                      "50%",

                    right:
                      12,

                    transform:
                      "translateY(-50%)",

                    width:
                      44,

                    height:
                      44,

                    borderRadius:
                      "50%",

                    border:
                      "1px solid rgba(0,0,0,.15)",

                    background:
                      "rgba(255,255,255,.9)",

                    cursor:
                      "pointer",

                    zIndex:
                      5,

                    fontSize:
                      24,
                  }}
                >
                  ›
                </button>

                <button
                  type="button"
                  aria-label="תמונה הבאה"
                  onClick={
                    nextImage
                  }
                  style={{
                    position:
                      "absolute",

                    top:
                      "50%",

                    left:
                      12,

                    transform:
                      "translateY(-50%)",

                    width:
                      44,

                    height:
                      44,

                    borderRadius:
                      "50%",

                    border:
                      "1px solid rgba(0,0,0,.15)",

                    background:
                      "rgba(255,255,255,.9)",

                    cursor:
                      "pointer",

                    zIndex:
                      5,

                    fontSize:
                      24,
                  }}
                >
                  ‹
                </button>

                <div
                  style={{
                    position:
                      "absolute",

                    bottom:
                      10,

                    left:
                      "50%",

                    transform:
                      "translateX(-50%)",

                    padding:
                      "5px 10px",

                    borderRadius:
                      20,

                    background:
                      "rgba(0,0,0,.55)",

                    color:
                      "#fff",

                    fontSize:
                      12,
                  }}
                >
                  {activeImageIndex +
                    1}
                  {" / "}
                  {gallery.length}
                </div>
              </>
            )}

            {!product.inStock && (
              <div className="out-of-stock-flag">
                אזל מהמלאי
              </div>
            )}
          </div>

          {gallery.length >
            1 && (
            <div
              style={{
                display:
                  "flex",

                gap:
                  10,

                overflowX:
                  "auto",

                marginTop:
                  12,

                paddingBottom:
                  6,
              }}
            >
              {gallery.map(
                (
                  image,
                  index
                ) => (
                  <button
                    type="button"
                    key={
                      `${image.url}-${index}`
                    }
                    onClick={() =>
                      setActiveImageIndex(
                        index
                      )
                    }
                    style={{
                      padding:
                        0,

                      width:
                        72,

                      height:
                        72,

                      flex:
                        "0 0 72px",

                      overflow:
                        "hidden",

                      borderRadius:
                        10,

                      cursor:
                        "pointer",

                      border:
                        index ===
                        activeImageIndex
                          ? "2px solid currentColor"
                          : "1px solid #ddd",

                      background:
                        "#fff",
                    }}
                  >
                    <img
                      src={
                        image.url
                      }
                      alt=""
                      style={{
                        width:
                          "100%",

                        height:
                          "100%",

                        objectFit:
                          "cover",
                      }}
                    />
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {/* ===============================================
            INFO
        =============================================== */}

        <div className="product-detail-info">
          <Link
            to={`/shop/${product.storeSlug}`}
            className="product-store text-link"
          >
            {product.store} ←
          </Link>

          <h1>
            {product.name}
          </h1>

          {(product.brand ||
            product.model) && (
            <p>
              {product.brand && (
                <strong>
                  {product.brand}
                </strong>
              )}

              {product.brand &&
                product.model &&
                " · "}

              {product.model}
            </p>
          )}

          <div className="price-row large">
            <strong>
              ₪ {product.price}
            </strong>

            <span className="fee-note">
              כולל מע״מ ועמלת
              פלטפורמה ₪ {fee}
            </span>
          </div>

          <p className="product-description">
            {product.description}
          </p>

          {/* =============================================
              MODEL
          ============================================= */}

          {usesVariants &&
            hasModelChoice && (
            <ProductOptionGroup
              title="דגם"
              values={
                models
              }
              selected={
                selectedModel
              }
              isAvailable={
                modelAvailable
              }
              onSelect={
                chooseModel
              }
            />
          )}

          {/* =============================================
              COLOR
          ============================================= */}

          {usesVariants &&
            hasColorChoice && (
            <ProductOptionGroup
              title="צבע"
              values={
                colors
              }
              selected={
                selectedColor
              }
              disabled={
                hasModelChoice &&
                !selectedModel
              }
              disabledText="בחר קודם דגם"
              isAvailable={
                colorAvailable
              }
              onSelect={
                chooseColor
              }
            />
          )}

          {/* =============================================
              VARIANT SIZE
          ============================================= */}

          {usesVariants &&
            hasVariantSizeChoice && (
            <ProductOptionGroup
              title="מידה"
              values={
                variantSizes
              }
              selected={
                selectedSize
              }
              disabled={
                (
                  hasModelChoice &&
                  !selectedModel
                ) ||
                (
                  hasColorChoice &&
                  !selectedColor
                )
              }
              disabledText="בחר קודם דגם וצבע"
              isAvailable={
                sizeAvailable
              }
              onSelect={
                chooseSize
              }
            />
          )}

          {/* =============================================
              SIMPLE PRODUCT SIZE
          ============================================= */}

          {!usesVariants &&
            product.hasSizes &&
            simpleSizes.length >
              0 && (
            <ProductOptionGroup
              title="מידה"
              values={
                simpleSizes
              }
              selected={
                selectedSize
              }
              isAvailable={
                sizeAvailable
              }
              onSelect={
                chooseSize
              }
            />
          )}

          {/* =============================================
              SELECTED VARIANT DETAILS
          ============================================= */}

          {selectedVariant && (
            <div
              className="checkout-note"
              style={{
                marginTop:
                  15,
              }}
            >
              <strong>
                הבחירה שלך:
              </strong>

              <div>
                {getAttributes(
                  selectedVariant
                ).model && (
                  <span>
                    דגם:{" "}
                    {
                      getAttributes(
                        selectedVariant
                      ).model
                    }
                    {" · "}
                  </span>
                )}

                {getAttributes(
                  selectedVariant
                ).color && (
                  <span>
                    צבע:{" "}
                    {
                      getAttributes(
                        selectedVariant
                      ).color
                    }
                    {" · "}
                  </span>
                )}

                {getAttributes(
                  selectedVariant
                ).size && (
                  <span>
                    מידה:{" "}
                    {
                      getAttributes(
                        selectedVariant
                      ).size
                    }
                  </span>
                )}
              </div>

              <small>
                מלאי זמין:{" "}
                {
                  selectedStock
                }
              </small>
            </div>
          )}

          {/* =============================================
              ERROR
          ============================================= */}

          {selectionError && (
            <p
              className="form-error"
              style={{
                marginTop:
                  12,
              }}
            >
              {selectionError}
            </p>
          )}

          {/* =============================================
              STOCK
          ============================================= */}

          <div
            className={`stock-flag ${
              product.inStock
                ? "stock-ok"
                : "stock-out"
            }`}
          >
            {product.inStock
              ? "במלאי, זמין למשלוח"
              : "המוצר אזל מהמלאי כרגע"}
          </div>

          {/* =============================================
              ADD TO CART
          ============================================= */}

          <button
            className="checkout-button"
            disabled={
              !product.inStock
            }
            onClick={
              handleAddToCart
            }
          >
            {product.inStock
              ? "הוספה לעגלה"
              : "אזל מהמלאי"}
          </button>

          {usesVariants &&
            product.inStock &&
            !selectedVariant && (
            <small
              style={{
                display:
                  "block",

                marginTop:
                  8,
              }}
            >
              יש לבחור את האפשרויות
              המתאימות לפני ההוספה
              לעגלה.
            </small>
          )}

          <div className="product-meta">
            <span>
              קטגוריה:{" "}
              {product.category}
            </span>

            {product.sku && (
              <span>
                SKU:{" "}
                {product.sku}
              </span>
            )}

            <span>
              משלוח תוך 1–5 ימי עסקים
            </span>
          </div>
        </div>
      </div>
    </main>
  )
}

// ======================================================
// OPTION GROUP
// ======================================================

function ProductOptionGroup({
  title,
  values,
  selected,
  onSelect,
  isAvailable,
  disabled = false,
  disabledText = "",
}) {
  if (
    !values ||
    values.length === 0
  ) {
    return null
  }

  return (
    <div
      style={{
        marginTop:
          20,
      }}
    >
      <div
        style={{
          display:
            "flex",

          alignItems:
            "center",

          justifyContent:
            "space-between",

          gap:
            10,

          marginBottom:
            10,
        }}
      >
        <strong>
          {title}
        </strong>

        {disabled &&
          disabledText && (
          <small>
            {disabledText}
          </small>
        )}
      </div>

      <div
        style={{
          display:
            "flex",

          flexWrap:
            "wrap",

          gap:
            8,
        }}
      >
        {values.map(
          (value) => {
            const available =
              typeof isAvailable ===
              "function"
                ? isAvailable(
                    value
                  )
                : true

            const optionDisabled =
              disabled ||
              !available

            return (
              <button
                type="button"
                key={
                  value
                }
                disabled={
                  optionDisabled
                }
                onClick={() =>
                  onSelect(
                    value
                  )
                }
                style={{
                  padding:
                    "10px 16px",

                  borderRadius:
                    10,

                  border:
                    selected ===
                    value
                      ? "2px solid currentColor"
                      : "1px solid #ccc",

                  background:
                    selected ===
                    value
                      ? "#f3f3f3"
                      : "#fff",

                  cursor:
                    optionDisabled
                      ? "not-allowed"
                      : "pointer",

                  opacity:
                    optionDisabled
                      ? 0.4
                      : 1,

                  textDecoration:
                    !available
                      ? "line-through"
                      : "none",
                }}
              >
                {value}
              </button>
            )
          }
        )}
      </div>
    </div>
  )
}

export default ProductPage