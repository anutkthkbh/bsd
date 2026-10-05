import { Link, NavLink } from "react-router-dom"

function Navbar({ cartCount, onCartOpen, user, onAccountClick }) {
  return (
    <header className="navbar">
      <Link to="/" className="brand">
        <span className="brand-mark">מ</span>
        <span>מדרום</span>
      </Link>
      <nav>
        <NavLink to="/" end>הקניון</NavLink>
        <NavLink to="/shop">חנויות</NavLink>
        <NavLink to="/reviews">ביקורות</NavLink>
        <NavLink to="/about">הסיפור שלנו</NavLink>
      </nav>
      <div className="nav-actions">
        {user ? (
          <NavLink to="/account" className="account-button">
            האזור האישי · {user.name.split(" ")[0]}
          </NavLink>
        ) : (
          <button className="account-button" onClick={onAccountClick}>
            התחברות
          </button>
        )}
        <button aria-label="מועדפים">♡</button>
        <button onClick={onCartOpen} aria-label="עגלת קניות">
          ⌑<i>{cartCount}</i>
        </button>
      </div>
    </header>
  )
}

export default Navbar
